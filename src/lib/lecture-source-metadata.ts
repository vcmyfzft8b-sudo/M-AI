import type { LectureArtifactRow, LectureRow } from "@/lib/database.types";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";
import {
  DEFAULT_NOTE_TTS_VOICE,
  normalizeNoteTtsVoice,
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

  return normalizeNoteTtsVoice(metadata.initialAudioVoice);
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

/** How the redesign names each source: "Audio", "PDF", "Link"… */
export function getLectureSourceLabel(
  sourceType: string,
  processingMetadata: unknown,
  t: Translate<MessageKey>,
) {
  if (sourceType === "link") {
    return t("source.link");
  }

  if (sourceType === "text") {
    /*
     * Photographed notes are filed as manual "text" imports, so this type covers two very
     * different things. The picker no longer takes pasted text, which leaves photos as the
     * only source still landing here — "Text" is now only the name for the older notes.
     */
    return t(isScanLectureMetadata(processingMetadata) ? "source.photos" : "source.text");
  }

  if (sourceType === "pdf") {
    return t("source.pdf");
  }

  if (sourceType === "presentation") {
    return t("source.presentation");
  }

  return t("source.audio");
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
  t: Translate<MessageKey>,
) {
  const sourceType = getEffectiveLectureSourceType(lecture);

  if (sourceType === "audio") {
    return formatSourceDuration(lecture.duration_seconds, t);
  }

  if (sourceType === "pdf" || sourceType === "presentation") {
    const pageCount = getSourcePageCount(lecture.processing_metadata);

    if (!pageCount) {
      return null;
    }

    /*
     * The count and its noun used to be joined here, with the Slovenian rule
     * (`count % 100`) written out below. Every language draws the plural
     * boundaries somewhere different, so the whole phrase is now one message
     * with a set of plural forms and `Intl.PluralRules` chooses between them.
     */
    return t(sourceType === "presentation" ? "source.slides" : "source.pages", {
      count: pageCount,
    });
  }

  return null;
}

/** "48 min" under an hour, "1 h 12 min" above it, as the design writes them. */
function formatSourceDuration(durationSeconds: number | null, t: Translate<MessageKey>) {
  if (!durationSeconds || durationSeconds <= 0) {
    return null;
  }

  const totalMinutes = Math.max(1, Math.round(durationSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!hours) {
    return t("source.duration.minutes", { minutes: totalMinutes });
  }

  return minutes
    ? t("source.duration.hoursMinutes", { hours, minutes })
    : t("source.duration.hours", { hours });
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
