import { NextResponse } from "next/server";
import { z } from "zod";

import { canAccessLectureContent, createBillingRequiredResponse } from "@/lib/billing";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import {
  editableNoteDocSchema,
  normalizeIncomingNoteDoc,
  parseStoredNoteDoc,
  readLectureArtifactForNoteDoc,
  saveEditableNoteDoc,
} from "@/lib/note-doc-server";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

const NOTES_DOC_MAX_BYTES = 256 * 1024;

const updateNotesDocSchema = z.object({
  expectedRevision: z.number().int().min(0),
  doc: editableNoteDocSchema,
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:notes-doc:patch",
    rules: rateLimitPresets.studySession,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, updateNotesDocSchema, {
    maxBytes: NOTES_DOC_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: await tr("api.invalidLectureId") }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const access = await canAccessLectureContent(user.id, id);

  if (!access.allowed) {
    return createBillingRequiredResponse(
      await tr("api.paidRequired.edit"),
      access.code,
    );
  }

  const artifact = await readLectureArtifactForNoteDoc(id);

  if (!artifact) {
    return NextResponse.json({ error: await tr("note.notReady") }, { status: 409 });
  }

  const currentRevision = artifact.editable_notes_revision ?? 0;

  if (currentRevision !== parsed.data.expectedRevision) {
    return NextResponse.json(
      {
        error: await tr("api.notesChanged"),
        revision: currentRevision,
        doc: parseStoredNoteDoc(artifact),
      },
      { status: 409 },
    );
  }

  const nextDoc = normalizeIncomingNoteDoc({
    value: parsed.data.doc,
    artifact,
  });
  const updatedArtifact = await saveEditableNoteDoc({
    lectureId: id,
    expectedRevision: parsed.data.expectedRevision,
    doc: nextDoc,
  });

  if (!updatedArtifact) {
    const latest = await readLectureArtifactForNoteDoc(id);
    return NextResponse.json(
      {
        error: await tr("api.notesChanged"),
        revision: latest?.editable_notes_revision ?? 0,
        doc: latest ? parseStoredNoteDoc(latest) : nextDoc,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    doc: parseStoredNoteDoc(updatedArtifact),
    revision: updatedArtifact.editable_notes_revision,
    updatedAt: updatedArtifact.editable_notes_updated_at,
  });
}
