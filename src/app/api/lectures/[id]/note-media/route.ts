import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiUser } from "@/lib/api-auth";
import { canAccessLectureContent, createBillingRequiredResponse } from "@/lib/billing";
import { MAX_SCAN_IMAGE_BYTES, STORAGE_BUCKET } from "@/lib/constants";
import type { LectureNoteMediaRow } from "@/lib/database.types";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { parseStoredNoteDoc, readLectureArtifactForNoteDoc, saveEditableNoteDoc } from "@/lib/note-doc-server";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import {
  inferScanImageMimeTypeFromFile,
  isCanonicalLectureNoteMediaStoragePath,
  isSupportedScanImageMimeType,
} from "@/lib/storage";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

const NOTE_MEDIA_FINALIZE_MAX_BYTES = 32 * 1024;

const finalizeNoteMediaSchema = z.object({
  mediaId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(120),
  byteSize: z.number().int().min(1).max(MAX_SCAN_IMAGE_BYTES),
  originalFileName: z.string().min(1).max(240).nullable().optional(),
  afterBlockId: z.string().min(1).max(160),
  expectedRevision: z.number().int().min(0),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getApiUser(request);

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:note-media:post",
    rules: rateLimitPresets.uploadFinalize,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, finalizeNoteMediaSchema, {
    maxBytes: NOTE_MEDIA_FINALIZE_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Neveljaven ID zapiska." }, { status: 400 });
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
      "Za urejanje tega zapiska je potreben plačljiv paket.",
      access.code,
    );
  }

  const mimeType = inferScanImageMimeTypeFromFile({
    mimeType: parsed.data.mimeType,
    fileName: parsed.data.originalFileName,
  });

  if (!isSupportedScanImageMimeType(mimeType, parsed.data.originalFileName)) {
    return NextResponse.json(
      { error: "Podprte so fotografije JPG, PNG, WebP, HEIC ali HEIF." },
      { status: 400 },
    );
  }

  if (
    !isCanonicalLectureNoteMediaStoragePath({
      path: parsed.data.storagePath,
      userId: user.id,
      lectureId: id,
      mediaId: parsed.data.mediaId,
    })
  ) {
    return NextResponse.json({ error: "Neveljavna pot fotografije." }, { status: 400 });
  }

  const artifact = await readLectureArtifactForNoteDoc(id);

  if (!artifact) {
    return NextResponse.json({ error: "Zapiski še niso pripravljeni." }, { status: 409 });
  }

  if (artifact.editable_notes_revision !== parsed.data.expectedRevision) {
    return NextResponse.json(
      {
        error: "Zapiski so se medtem spremenili. Osveži stran in poskusi znova.",
        revision: artifact.editable_notes_revision,
        doc: parseStoredNoteDoc(artifact),
      },
      { status: 409 },
    );
  }

  const service = createSupabaseServiceRoleClient();
  const { data: media, error: mediaError } = await service
    .from("lecture_note_media")
    .insert({
      id: parsed.data.mediaId,
      lecture_id: id,
      user_id: user.id,
      storage_path: parsed.data.storagePath,
      mime_type: mimeType,
      byte_size: parsed.data.byteSize,
      original_file_name: parsed.data.originalFileName ?? null,
    } as never)
    .select("*")
    .single();

  if (mediaError) {
    return NextResponse.json({ error: mediaError.message }, { status: 500 });
  }

  const storedDoc = parseStoredNoteDoc(artifact);
  const nextDoc = {
    ...storedDoc,
    updatedAt: new Date().toISOString(),
    mediaBlocks: [
      ...storedDoc.mediaBlocks,
      {
        id: crypto.randomUUID(),
        mediaId: parsed.data.mediaId,
        afterBlockId: parsed.data.afterBlockId,
        createdAt: new Date().toISOString(),
      },
    ],
  };
  const updatedArtifact = await saveEditableNoteDoc({
    lectureId: id,
    expectedRevision: parsed.data.expectedRevision,
    doc: nextDoc,
  });

  if (!updatedArtifact) {
    await Promise.all([
      service.from("lecture_note_media").delete().eq("id", parsed.data.mediaId),
      service.storage.from(STORAGE_BUCKET).remove([parsed.data.storagePath]),
    ]);
    const latest = await readLectureArtifactForNoteDoc(id);
    return NextResponse.json(
      {
        error: "Zapiski so se medtem spremenili. Osveži stran in poskusi znova.",
        revision: latest?.editable_notes_revision ?? parsed.data.expectedRevision,
        doc: latest ? parseStoredNoteDoc(latest) : storedDoc,
      },
      { status: 409 },
    );
  }

  const mediaRow = media as LectureNoteMediaRow;
  const { data: signed } = await service.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(mediaRow.storage_path, 60 * 60);

  return NextResponse.json({
    doc: parseStoredNoteDoc(updatedArtifact),
    revision: updatedArtifact.editable_notes_revision,
    media: {
      ...mediaRow,
      signedUrl: signed?.signedUrl ?? "",
    },
  });
}
