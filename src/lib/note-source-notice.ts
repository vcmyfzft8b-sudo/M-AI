import type { MessageKey } from "@/lib/i18n/messages/keys";

/**
 * What the finished note should tell its reader about how it was made, when that differs from
 * "we read your material and condensed it".
 *
 * Two cases, both from the 2026-09 failed-notes work, and both situations that used to end in a
 * red failure card. Now the note is made anyway, and it says so in one line instead of leaving the
 * learner to wonder why the note does not match what they uploaded:
 *  - topic notes: the material held exercises, a question or a bare list rather than an
 *    explanation, so the note teaches the topic it points at (notes/topic-notes.ts);
 *  - missing photos: some pages never reached us, and the note was made from the rest.
 *
 * Pure and dependency-free so the note screen and its tests can share it.
 */
export type NoteSourceNotice = {
  key: MessageKey;
  params?: Record<string, number>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function resolveNoteSourceNotices(params: {
  artifactMetadata: unknown;
  processingMetadata: unknown;
}): NoteSourceNotice[] {
  const notices: NoteSourceNotice[] = [];
  const topicNotes = asRecord(asRecord(params.artifactMetadata)?.topicNotes);

  if (topicNotes) {
    const kind = topicNotes.materialKind;
    notices.push({
      key:
        kind === "exercises"
          ? "note.sourceNotice.topicExercises"
          : kind === "question_or_request"
            ? "note.sourceNotice.topicQuestion"
            : "note.sourceNotice.topicOther",
    });
  }

  const modelMetadata = asRecord(asRecord(asRecord(params.processingMetadata)?.manualImport)?.modelMetadata);
  const missing = Number(modelMetadata?.missingImageCount ?? 0);
  const uploads = Array.isArray(modelMetadata?.sourceImageUploads)
    ? modelMetadata.sourceImageUploads.length
    : 0;
  const salvage = asRecord(asRecord(params.processingMetadata)?.uploadSalvage);
  const expected = Number(salvage?.expected ?? 0);

  if (Number.isFinite(missing) && missing > 0) {
    notices.push({
      key: "note.sourceNotice.missingPhotos",
      params: { missing, total: Math.max(expected, uploads, missing) },
    });
  }

  return notices;
}
