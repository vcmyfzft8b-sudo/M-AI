// Kept free of "server-only" so the capture contract stays unit-testable
// (tests/failure-capture.test.mjs) outside the Next.js runtime.

/**
 * Hard cap on the snapshot, matching the largest raw source the intake admits (4M chars).
 * Anything longer is not something the app accepted in one piece, so a truncated snapshot is
 * still a faithful reproduction input.
 */
export const MAX_CAPTURE_CHARS = 4_000_000;

export type FailureCaptureRecord = {
  lecture_id: string;
  user_id: string | null;
  source_type: string | null;
  language_hint: string | null;
  error_message: string | null;
  source_text: string | null;
  source_blocks: unknown;
  processing_metadata: unknown;
  source_char_count: number;
};

/**
 * The snapshot the triage automation replays: the manual-import text and blocks when the lecture
 * came in as text/document/link/scan, otherwise the joined transcript. The processing metadata
 * rides along minus the bulky import payload (its text is already the snapshot), so the bot sees
 * flags and stage history without a second copy of the source.
 */
export function buildFailureCaptureRecord(params: {
  lectureId: string;
  userId: string | null;
  sourceType: string | null;
  languageHint: string | null;
  errorMessage: string | null;
  processingMetadata: unknown;
  transcriptText: string | null;
}): FailureCaptureRecord {
  const metadata =
    params.processingMetadata &&
    typeof params.processingMetadata === "object" &&
    !Array.isArray(params.processingMetadata)
      ? (params.processingMetadata as Record<string, unknown>)
      : {};
  const manualImport =
    metadata.manualImport && typeof metadata.manualImport === "object" && !Array.isArray(metadata.manualImport)
      ? (metadata.manualImport as Record<string, unknown>)
      : null;

  const manualText =
    typeof manualImport?.text === "string" && manualImport.text.trim().length > 0
      ? manualImport.text
      : null;
  const sourceText = manualText ?? params.transcriptText ?? null;

  return {
    lecture_id: params.lectureId,
    user_id: params.userId,
    source_type: params.sourceType,
    language_hint: params.languageHint,
    error_message: params.errorMessage?.slice(0, 2_000) ?? null,
    source_text: sourceText ? sourceText.slice(0, MAX_CAPTURE_CHARS) : null,
    source_blocks: Array.isArray(manualImport?.blocks) ? manualImport.blocks : null,
    // The import text/blocks are already captured above; a second copy inside the metadata
    // snapshot would double the row for nothing.
    processing_metadata: manualImport
      ? { ...metadata, manualImport: { ...manualImport, text: undefined, blocks: undefined } }
      : metadata,
    source_char_count: sourceText ? Math.min(sourceText.length, MAX_CAPTURE_CHARS) : 0,
  };
}
