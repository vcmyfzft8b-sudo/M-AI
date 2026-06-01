export type NoteEnrichmentStage = "checking_document_images" | "complete";

const NOTE_ENRICHMENT_METADATA_KEY = "noteEnrichment";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function withNoteEnrichmentStage(
  metadata: Record<string, unknown>,
  stage: NoteEnrichmentStage,
) {
  return {
    ...metadata,
    [NOTE_ENRICHMENT_METADATA_KEY]: {
      stage,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function getNoteEnrichmentStage(metadata: unknown) {
  if (!isRecord(metadata) || !isRecord(metadata[NOTE_ENRICHMENT_METADATA_KEY])) {
    return null;
  }

  const stage = metadata[NOTE_ENRICHMENT_METADATA_KEY].stage;

  return typeof stage === "string" ? stage : null;
}

export function isNoteEnrichmentPending(metadata: unknown) {
  const stage = getNoteEnrichmentStage(metadata);

  return stage != null && stage !== "complete";
}

export function isNoteEnrichmentCompleteOrLegacy(metadata: unknown) {
  const stage = getNoteEnrichmentStage(metadata);

  return stage == null || stage === "complete";
}
