import "server-only";

import { z } from "zod";

import { hashNotesContent } from "@/lib/tutor/plan-cache";

import type { Json, LectureArtifactRow } from "@/lib/database.types";
import {
  NOTE_DOC_VERSION,
  parseEditableNoteDoc,
  serializeEditableNoteDoc,
  type EditableNoteDoc,
} from "@/lib/note-doc";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const MAX_NOTE_ANNOTATIONS = 2_000;
export const MAX_NOTE_MEDIA_BLOCKS = 200;

export const noteAnnotationSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(["highlight", "underline"]),
  startWordIndex: z.number().int().min(0).max(200_000),
  endWordIndex: z.number().int().min(0).max(200_000),
  colorId: z.string().min(1).max(32).optional(),
  createdAt: z.string().datetime(),
}).refine((value) => value.endWordIndex >= value.startWordIndex, {
  message: "Invalid annotation range.",
});

export const noteMediaBlockSchema = z.object({
  id: z.string().min(1).max(120),
  mediaId: z.string().uuid(),
  afterBlockId: z.string().min(1).max(160),
  widthPercent: z.number().int().min(35).max(100).optional(),
  xPercent: z.number().int().min(0).max(100).optional(),
  createdAt: z.string().datetime(),
});

export const editableNoteDocSchema = z.object({
  version: z.literal(NOTE_DOC_VERSION),
  baseNotesHash: z.string().min(1).max(128),
  updatedAt: z.string().datetime(),
  annotations: z.array(noteAnnotationSchema).max(MAX_NOTE_ANNOTATIONS),
  mediaBlocks: z.array(noteMediaBlockSchema).max(MAX_NOTE_MEDIA_BLOCKS),
});

/*
 * Lives in tutor/plan-cache.ts, which is free of "server-only" so the cache rules that depend on
 * it stay testable. Re-exported here because this is where every caller already looks for it, and
 * because two hashes of the same note would be two caches expiring at different moments.
 */
export { hashNotesContent };

export async function readLectureArtifactForNoteDoc(lectureId: string) {
  const service = createSupabaseServiceRoleClient();
  const { data, error } = await service
    .from("lecture_artifacts")
    .select("*")
    .eq("lecture_id", lectureId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as LectureArtifactRow | null;
}

export function parseStoredNoteDoc(artifact: LectureArtifactRow) {
  return parseEditableNoteDoc(
    artifact.editable_notes_doc,
    hashNotesContent(artifact.structured_notes_md),
  );
}

export function normalizeIncomingNoteDoc(params: {
  value: z.infer<typeof editableNoteDocSchema>;
  artifact: LectureArtifactRow;
}) {
  const baseNotesHash = hashNotesContent(params.artifact.structured_notes_md);

  return {
    version: NOTE_DOC_VERSION,
    baseNotesHash,
    updatedAt: new Date().toISOString(),
    annotations: params.value.annotations,
    mediaBlocks: params.value.mediaBlocks,
  } satisfies EditableNoteDoc;
}

export async function saveEditableNoteDoc(params: {
  lectureId: string;
  expectedRevision: number;
  doc: EditableNoteDoc;
}) {
  const service = createSupabaseServiceRoleClient();
  const updatedAt = new Date().toISOString();
  let query = service
    .from("lecture_artifacts")
    .update({
      editable_notes_doc: serializeEditableNoteDoc({
        ...params.doc,
        updatedAt,
      }) as Json,
      editable_notes_revision: params.expectedRevision + 1,
      editable_notes_updated_at: updatedAt,
    } as never)
    .eq("lecture_id", params.lectureId);

  query =
    params.expectedRevision === 0
      ? query.or("editable_notes_revision.eq.0,editable_notes_revision.is.null")
      : query.eq("editable_notes_revision", params.expectedRevision);

  const { data, error } = await query.select("*").maybeSingle();

  if (error) {
    throw error;
  }

  return data as LectureArtifactRow | null;
}
