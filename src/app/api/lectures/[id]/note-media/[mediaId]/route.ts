import { NextResponse } from "next/server";
import { z } from "zod";

import { canAccessLectureContent, createBillingRequiredResponse } from "@/lib/billing";
import { STORAGE_BUCKET } from "@/lib/constants";
import type { LectureNoteMediaRow } from "@/lib/database.types";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { parseStoredNoteDoc, readLectureArtifactForNoteDoc, saveEditableNoteDoc } from "@/lib/note-doc-server";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

const mediaParamsSchema = z.object({
  id: routeIdParamSchema.shape.id,
  mediaId: z.string().uuid(),
});

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; mediaId: string }> },
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
    route: "api:lectures:note-media:delete",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = mediaParamsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: await tr("api.invalidPhotoId") }, { status: 400 });
  }

  const { id, mediaId } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const access = await canAccessLectureContent(user.id, id);

  if (!access.allowed) {
    return createBillingRequiredResponse(
      await tr("api.paidRequired.edit"),
      access.code,
    );
  }

  const service = createSupabaseServiceRoleClient();
  const { data: media, error: mediaError } = await service
    .from("lecture_note_media")
    .select("*")
    .eq("id", mediaId)
    .eq("lecture_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (mediaError) {
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }

  if (!media) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const artifact = await readLectureArtifactForNoteDoc(id);

  if (!artifact) {
    return NextResponse.json({ error: await tr("note.notReady") }, { status: 409 });
  }

  const storedDoc = parseStoredNoteDoc(artifact);
  const nextDoc = {
    ...storedDoc,
    updatedAt: new Date().toISOString(),
    mediaBlocks: storedDoc.mediaBlocks.filter((block) => block.mediaId !== mediaId),
  };
  const updatedArtifact = await saveEditableNoteDoc({
    lectureId: id,
    expectedRevision: artifact.editable_notes_revision,
    doc: nextDoc,
  });

  if (!updatedArtifact) {
    const latest = await readLectureArtifactForNoteDoc(id);
    return NextResponse.json(
      {
        error: await tr("api.notesChanged"),
        revision: latest?.editable_notes_revision ?? artifact.editable_notes_revision,
        doc: latest ? parseStoredNoteDoc(latest) : storedDoc,
      },
      { status: 409 },
    );
  }

  const mediaRow = media as LectureNoteMediaRow;
  await Promise.all([
    service.from("lecture_note_media").delete().eq("id", mediaId),
    service.storage.from(STORAGE_BUCKET).remove([mediaRow.storage_path]),
  ]);

  return NextResponse.json({
    doc: parseStoredNoteDoc(updatedArtifact),
    revision: updatedArtifact.editable_notes_revision,
    deletedMediaId: mediaId,
  });
}
