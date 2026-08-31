import type { LectureArtifactRow, LectureRow } from "@/lib/database.types";
import {
  DEFAULT_NOTE_TTS_VOICE,
  NOTE_TTS_VOICES,
  type NoteTtsVoice,
} from "@/lib/note-tts-settings";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isScanLectureMetadata(metadata: unknown) {
  if (!isRecord(metadata)) {
    return false;
  }

  if (Array.isArray(metadata.pendingScanImages) && metadata.pendingScanImages.length > 0) {
    return true;
  }

  const manualImport = metadata.manualImport;

  if (!isRecord(manualImport)) {
    return false;
  }

  const modelMetadata = manualImport.modelMetadata;

  return isRecord(modelMetadata) && modelMetadata.importMode === "scan";
}

export function isScanArtifactMetadata(metadata: unknown) {
  if (!isRecord(metadata)) {
    return false;
  }

  return (
    metadata.importMode === "scan" ||
    (Array.isArray(metadata.sourceImageUploads) && metadata.sourceImageUploads.length > 0)
  );
}

const MANUAL_SOURCE_TYPES = new Set(["text", "pdf", "link", "presentation"]);

export function getManualImportSourceType(metadata: unknown) {
  if (!isRecord(metadata) || !isRecord(metadata.manualImport)) {
    return null;
  }

  const sourceType = metadata.manualImport.sourceType;

  return typeof sourceType === "string" && MANUAL_SOURCE_TYPES.has(sourceType)
    ? sourceType
    : null;
}

export function shouldCreateInitialNoteAudio(metadata: unknown) {
  return isRecord(metadata) && metadata.createInitialAudio === true;
}

export function getInitialNoteAudioVoice(metadata: unknown): NoteTtsVoice {
  if (!isRecord(metadata)) {
    return DEFAULT_NOTE_TTS_VOICE;
  }

  const voice = metadata.initialAudioVoice;

  return NOTE_TTS_VOICES.find((candidate) => candidate === voice) ?? DEFAULT_NOTE_TTS_VOICE;
}

export function getEffectiveLectureSourceType(
  lecture: Pick<LectureRow, "source_type" | "processing_metadata">,
) {
  return getManualImportSourceType(lecture.processing_metadata) ?? lecture.source_type;
}

export function lectureShowsTranscript(params: {
  lecture: Pick<LectureRow, "source_type" | "processing_metadata">;
  artifact?: Pick<LectureArtifactRow, "model_metadata"> | null;
}) {
  const sourceType = getEffectiveLectureSourceType(params.lecture);

  return (
    sourceType === "audio" ||
    isScanLectureMetadata(params.lecture.processing_metadata) ||
    isScanArtifactMetadata(params.artifact?.model_metadata)
  );
}

/** How the redesign names each source: "Zvok", "PDF", "Povezava"… */
export function getLectureSourceLabel(sourceType: string, processingMetadata?: unknown) {
  if (sourceType === "link") {
    return "Povezava";
  }

  if (sourceType === "text") {
    /*
     * Photographed notes are filed as manual "text" imports, so this type covers two very
     * different things. The picker no longer takes pasted text, which leaves photos as the
     * only source still landing here — "Besedilo" is now only the name for the older notes.
     */
    return isScanLectureMetadata(processingMetadata) ? "Fotografije" : "Besedilo";
  }

  if (sourceType === "pdf") {
    return "PDF";
  }

  if (sourceType === "presentation") {
    return "Predstavitev";
  }

  return "Zvok";
}

/**
 * The detail the redesign prints after the source on a note row — "Zvok,
 * 1 h 12 min", "PDF, 24 strani". A link or pasted text carries none, and
 * neither does a note whose source we cannot measure.
 *
 * Recordings measure in time. Documents measure in pages, which is not a
 * column: it is the page count of the blocks the extractor produced, stored
 * with the import and counted from the blocks themselves for notes created
 * before it was.
 */
export function getLectureSourceDetail(
  lecture: Pick<LectureRow, "source_type" | "duration_seconds" | "processing_metadata">,
) {
  const sourceType = getEffectiveLectureSourceType(lecture);

  if (sourceType === "audio") {
    return formatSourceDuration(lecture.duration_seconds);
  }

  if (sourceType === "pdf" || sourceType === "presentation") {
    const pageCount = getSourcePageCount(lecture.processing_metadata);

    if (!pageCount) {
      return null;
    }

    return sourceType === "presentation"
      ? `${pageCount} ${slovenianPlural(pageCount, "prosojnica", "prosojnici", "prosojnice", "prosojnic")}`
      : `${pageCount} ${slovenianPlural(pageCount, "stran", "strani", "strani", "strani")}`;
  }

  return null;
}

/** "48 min" under an hour, "1 h 12 min" above it, as the design writes them. */
function formatSourceDuration(durationSeconds: number | null) {
  if (!durationSeconds || durationSeconds <= 0) {
    return null;
  }

  const totalMinutes = Math.max(1, Math.round(durationSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!hours) {
    return `${totalMinutes} min`;
  }

  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

function getSourcePageCount(metadata: unknown) {
  if (!isRecord(metadata) || !isRecord(metadata.manualImport)) {
    return null;
  }

  const manualImport = metadata.manualImport;
  const stored = isRecord(manualImport.modelMetadata)
    ? manualImport.modelMetadata.sourcePageCount
    : null;

  if (typeof stored === "number" && Number.isFinite(stored) && stored > 0) {
    return Math.round(stored);
  }

  if (!Array.isArray(manualImport.blocks)) {
    return null;
  }

  const pageNumbers = new Set<number>();

  for (const block of manualImport.blocks) {
    if (isRecord(block) && typeof block.pageNumber === "number") {
      pageNumbers.add(block.pageNumber);
    }
  }

  return pageNumbers.size || null;
}

/** Slovenian counts take four forms, by the count modulo 100. */
function slovenianPlural(
  count: number,
  one: string,
  two: string,
  few: string,
  many: string,
) {
  const remainder = count % 100;

  if (remainder === 1) {
    return one;
  }

  if (remainder === 2) {
    return two;
  }

  if (remainder === 3 || remainder === 4) {
    return few;
  }

  return many;
}
