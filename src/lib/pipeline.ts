import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";

import {
  AI_SOURCE_TOO_EXTENSIVE_MESSAGE,
  isBudgetOverrunFailure,
  toUserFacingAiErrorMessage,
} from "@/lib/ai/errors";
import { chatAnswerSchema } from "@/lib/ai/schemas";
import { generateStructuredObject } from "@/lib/ai/json";
import { createEmbeddings } from "@/lib/ai/embeddings";
import { parseAudioChunkManifest } from "@/lib/audio-processing";
import { CHAT_MATCH_COUNT } from "@/lib/constants";
import { sanitizeJsonForDatabase } from "@/lib/database-text";
import {
  attachDocumentImagesToNotes,
  getStoredDocumentImagesFromMetadata,
} from "@/lib/document-note-media";
import { LECTURE_FAILURE_METADATA_KEY } from "@/lib/lecture-failure-codes";
import {
  isExpectedLectureInputFailure,
  LectureNoLongerExistsError,
  toLectureFailureCode,
} from "@/lib/lecture-processing-errors";
import { buildGeneratedContentLanguageInstruction } from "@/lib/languages";
import {
  getEffectiveLectureSourceType,
  getInitialNoteAudioVoice,
  shouldCreateInitialNoteAudio,
} from "@/lib/lecture-source-metadata";
import { captureBackgroundError, captureRouteError } from "@/lib/monitoring";
import {
  buildSyntheticTranscriptFromTextSource,
  estimateTextSourceDurationSeconds,
  type StructuredSourceBlock,
} from "@/lib/text-source-processing";
import type { ChatMessageWithCitations } from "@/lib/types";
import { isPreparingInitialNoteAudio } from "@/lib/note-audio-stage";
import { generateNotesFromTranscript, type NotesGenerationPhase } from "@/lib/note-generation";
import { applyAiHighlightsToNote } from "@/lib/notes/ai-highlights";
import { captureGenerationFailureInput } from "@/lib/notes/failure-capture";
import {
  clearGenerationCache,
  generationCacheKey,
  stageModelCacheKeyPart,
  withGenerationCheckpoint,
} from "@/lib/notes/generation-cache";
import { assertLectureGenerationWithinBudget } from "@/lib/notes/generation-guard";
import { withNoteEnrichmentStage } from "@/lib/note-enrichment-status";
import {
  markInitialNoteAudioPreparing,
  prepareInitialNoteTtsChunksSafely,
} from "@/lib/note-tts";
import { NoReadableScanTextError } from "@/lib/scan-ocr-errors";
import {
  condenseTranscriptForNotes,
  PIPELINE_SOURCE_TEXT_TARGET_CHARS,
} from "@/lib/source-condensation";
import { createAiChunkSelector } from "@/lib/source-condensation-ai";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { normalizeMimeType } from "@/lib/storage";
import { serializeVector } from "@/lib/utils";
import { getTranscriptionProvider } from "@/lib/transcription/provider";
import { NoClearSpeechDetectedError } from "@/lib/transcription/types";

const transcriptionProvider = getTranscriptionProvider();
const EMBEDDING_BATCH_SIZE = 100;
const TRANSCRIPT_SEGMENT_INSERT_BATCH_SIZE = 25;

/** Validates a replayed condensation checkpoint before it stands in for the model's selection. */
const condensedTranscriptCheckpointSchema = z.object({
  segments: z.array(
    z.object({
      idx: z.number(),
      startMs: z.number(),
      endMs: z.number(),
      speakerLabel: z.string().nullable(),
      text: z.string(),
    }),
  ),
  meta: z.record(z.string(), z.unknown()),
});

/** Keeps whole segments while they fit; the first one is always kept so the result is never empty. */
function clampSegmentsToChars<TSegment extends { text: string }>(
  segments: TSegment[],
  maxChars: number,
) {
  const kept: TSegment[] = [];
  let total = 0;

  for (const segment of segments) {
    if (kept.length > 0 && total + segment.text.length > maxChars) {
      break;
    }

    kept.push(segment);
    total += segment.text.length;
  }

  return kept;
}

type LecturePipelineRow = {
  id: string;
  user_id: string;
  storage_path: string | null;
  language_hint: string | null;
  duration_seconds: number | null;
  source_type: string | null;
  title: string | null;
  processing_metadata: unknown;
};

type TranscriptSegmentInsertRow = {
  lecture_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker_label: string | null;
  text: string;
  embedding: string | null;
};

function parseProcessingMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

// How many runs of one lecture may die on the invocation budget before the pipeline stops
// retrying for the learner and calls the material too extensive. Two automatic retries means
// three full runs — and on the Inngest path each run already spends several step attempts, every
// one against a fresh budget with all finished work checkpointed. Measured on the 2026-08-27
// overrun: the run after the failed one completed in 80 seconds, because only the unfinished
// stages were left to buy.
const MAX_BUDGET_FAILURE_RUNS = 3;
// Lives in processing_metadata next to `failure`; cleared by updateLectureProcessingState the
// moment a run reaches "ready".
const BUDGET_FAILURE_COUNT_KEY = "budgetFailureCount";

function readBudgetFailureCount(metadata: Record<string, unknown>) {
  const value = metadata[BUDGET_FAILURE_COUNT_KEY];

  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Presses the retry button the learner would otherwise have to find themselves. The job chosen
 * mirrors the manual retry route (src/app/api/lectures/[id]/retry) exactly, and anything that
 * route would refuse to retry is not retried here either. Imported lazily because jobs.ts
 * imports this module; by the time a failure is being recorded, both modules are long evaluated.
 */
async function enqueueBudgetOverrunRetry(params: {
  lectureId: string;
  sourceType: string | null;
  metadata: Record<string, unknown>;
}) {
  const jobs = await import("@/lib/jobs");
  const pendingDocument =
    params.metadata.pendingDocument && typeof params.metadata.pendingDocument === "object";
  const pendingLinkUrl =
    typeof params.metadata.pendingLinkUrl === "string" &&
    params.metadata.pendingLinkUrl.trim().length > 0;
  const effectiveSourceType = getEffectiveLectureSourceType({
    source_type: params.sourceType,
    processing_metadata: params.metadata,
  } as never);

  if (pendingDocument) {
    await jobs.enqueueLectureDocumentProcessing(params.lectureId);
    return true;
  }

  if (pendingLinkUrl) {
    await jobs.enqueueLectureLinkProcessing(params.lectureId);
    return true;
  }

  if (effectiveSourceType === "audio") {
    await jobs.enqueueLectureProcessing(params.lectureId);
    return true;
  }

  if (
    params.metadata.manualImport &&
    typeof params.metadata.manualImport === "object" &&
    !Array.isArray(params.metadata.manualImport)
  ) {
    await jobs.enqueueLectureNotesGeneration(params.lectureId);
    return true;
  }

  return false;
}

async function updateLectureProcessingState(params: {
  lectureId: string;
  processingMetadata: unknown;
  stage:
    | "transcribing"
    | "generating_notes"
    | "checking_document_images"
    | "ready"
    | "failed";
  errorMessage?: string | null;
  durationSeconds?: number | null;
  title?: string | null;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const stored = parseProcessingMetadata(params.processingMetadata);
  // A finished lecture wipes its budget-failure count: the count exists to stop the automatic
  // retry of one struggling run from looping, not to hold a grudge — a later regeneration of the
  // same lecture starts with fresh retries. Copied rather than deleted in place, because
  // parseProcessingMetadata returns the caller's own object.
  const { [BUDGET_FAILURE_COUNT_KEY]: staleBudgetFailures, ...withoutBudgetFailures } = stored;
  const metadata = params.stage === "ready" ? withoutBudgetFailures : stored;

  void staleBudgetFailures;

  const status = params.stage === "checking_document_images" ? "generating_notes" : params.stage;

  // An error message can quote the source text, and the metadata we merge back carries
  // extractor output, so both can carry characters Postgres refuses. This write is how a
  // failure is recorded, so it must never be the thing that fails.
  const { error } = await supabase
    .from("lectures")
    .update(
      sanitizeJsonForDatabase({
        status,
        error_message: params.errorMessage ?? null,
        duration_seconds: params.durationSeconds,
        title: params.title,
        processing_metadata: {
          ...metadata,
          processing: {
            stage: params.stage,
            updatedAt: new Date().toISOString(),
            errorMessage: params.errorMessage ?? null,
          },
        },
      }) as never,
    )
    .eq("id", params.lectureId);

  if (error) {
    throw error;
  }
}

function toErrorMessage(error: unknown) {
  return toUserFacingAiErrorMessage(error);
}

function getTranscriptionDiagnostics(error: unknown) {
  return error instanceof NoClearSpeechDetectedError ? error.diagnostics : null;
}

function getScanOcrDiagnostics(error: unknown) {
  return error instanceof NoReadableScanTextError ? error.diagnostics : null;
}

async function insertTranscriptSegmentsInBatches(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  transcriptRows: TranscriptSegmentInsertRow[],
) {
  for (
    let start = 0;
    start < transcriptRows.length;
    start += TRANSCRIPT_SEGMENT_INSERT_BATCH_SIZE
  ) {
    const batch = transcriptRows.slice(start, start + TRANSCRIPT_SEGMENT_INSERT_BATCH_SIZE);
    const { error } = await supabase.from("transcript_segments").insert(batch as never);

    if (error) {
      throw error;
    }
  }
}

function assertTranscriptCoverage(params: {
  transcript: {
    text: string;
    segments: Array<{ startMs: number; endMs: number; text: string }>;
    durationSeconds: number;
  };
  expectedDurationSeconds: number | null;
}) {
  const { transcript, expectedDurationSeconds } = params;

  if (transcript.segments.length === 0 || transcript.text.trim().length === 0) {
    throw new Error("Transcript is empty.");
  }

  if (!expectedDurationSeconds || expectedDurationSeconds < 60) {
    return;
  }

  const expectedEndMs = expectedDurationSeconds * 1000;
  const lastSegmentEndMs = transcript.segments.reduce(
    (maxEndMs, segment) => Math.max(maxEndMs, segment.endMs),
    0,
  );
  const allowedGapMs = Math.max(30_000, expectedEndMs * 0.05);

  if (expectedEndMs - lastSegmentEndMs > allowedGapMs) {
    throw new Error(
      `Transcript appears incomplete. Expected about ${expectedDurationSeconds}s but only covered ${Math.round(lastSegmentEndMs / 1000)}s.`,
    );
  }
}

async function getLectureForPipeline(params: { lectureId: string }) {
  const supabase = createSupabaseServiceRoleClient();
  const { data: lecture, error: lectureError } = await supabase
    .from("lectures")
    .select("*")
    .eq("id", params.lectureId)
    .maybeSingle();

  if (lectureError) {
    throw lectureError;
  }

  // A learner deleting a lecture mid-run reaches the pipeline here first. `.single()` used to
  // raise PostgREST's "Cannot coerce the result to a single JSON object" for it, which named
  // neither the lecture nor the deletion and travelled all the way into the lecture's
  // error_message and into Sentry as an unexplained defect.
  if (!lecture) {
    throw new LectureNoLongerExistsError(params.lectureId);
  }

  return {
    supabase,
    lecture: lecture as LecturePipelineRow,
  };
}

export async function transcribeLectureContent(params: { lectureId: string }) {
  const { supabase, lecture } = await getLectureForPipeline(params);

  if (!lecture.storage_path) {
    throw new Error("Lecture has no storage path.");
  }

  await supabase
    .from("lectures");
  await updateLectureProcessingState({
    lectureId: lecture.id,
    processingMetadata: lecture.processing_metadata,
    stage: "transcribing",
  });

  const audioChunks = parseAudioChunkManifest(
    lecture.processing_metadata && typeof lecture.processing_metadata === "object"
      ? (lecture.processing_metadata as Record<string, unknown>).audioChunks
      : null,
  ).sort((left, right) => left.index - right.index);

  const transcript =
    audioChunks.length > 0 && transcriptionProvider.transcribeChunks
      ? await transcriptionProvider.transcribeChunks({
          chunks: await Promise.all(
            audioChunks.map(async (chunk) => {
              const { data: chunkBlob, error: chunkDownloadError } = await supabase.storage
                .from("lecture-audio")
                .download(chunk.path);

              if (chunkDownloadError) {
                throw chunkDownloadError;
              }

              return {
                file: new File([chunkBlob], chunk.path.split("/").pop() ?? `chunk-${chunk.index}.wav`, {
                  type: normalizeMimeType(chunkBlob.type || chunk.mimeType),
                }),
                startMs: chunk.startMs,
                endMs: chunk.endMs,
              };
            }),
          ),
          languageHint: lecture.language_hint,
          durationSeconds: lecture.duration_seconds,
        })
      : await (async () => {
          const storagePath = lecture.storage_path;

          if (!storagePath) {
            throw new Error("Lecture has no storage path.");
          }

          const { data: audioBlob, error: downloadError } = await supabase.storage
            .from("lecture-audio")
            .download(storagePath);

          if (downloadError) {
            throw downloadError;
          }

          const file = new File(
            [audioBlob],
            storagePath.split("/").pop() ?? "lecture.webm",
            {
              type: normalizeMimeType(audioBlob.type || "audio/webm"),
            },
          );

          return transcriptionProvider.transcribe({
            file,
            languageHint: lecture.language_hint,
            durationSeconds: lecture.duration_seconds,
          });
        })();

  assertTranscriptCoverage({
    transcript,
    expectedDurationSeconds: lecture.duration_seconds,
  });

  const embeddings: number[][] = [];

  for (let start = 0; start < transcript.segments.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = transcript.segments.slice(start, start + EMBEDDING_BATCH_SIZE);
    embeddings.push(
      ...(await createEmbeddings(batch.map((segment: { text: string }) => segment.text))),
    );
  }

  await supabase.from("transcript_segments").delete().eq("lecture_id", lecture.id);

  const transcriptRows = transcript.segments.map((segment: {
    idx: number;
    startMs: number;
    endMs: number;
    speakerLabel: string | null;
    text: string;
  }, index: number) => ({
    lecture_id: lecture.id,
    idx: segment.idx,
    start_ms: segment.startMs,
    end_ms: segment.endMs,
    speaker_label: segment.speakerLabel,
    text: segment.text,
    embedding: embeddings[index] ? serializeVector(embeddings[index]) : null,
  }));

  if (transcriptRows.length > 0) {
    await insertTranscriptSegmentsInBatches(supabase, transcriptRows);
  }

  await updateLectureProcessingState({
    lectureId: lecture.id,
    processingMetadata: lecture.processing_metadata,
    stage: "generating_notes",
    durationSeconds: transcript.durationSeconds || lecture.duration_seconds,
  });
}

export async function generateLectureNotesFromStoredTranscript(params: {
  lectureId: string;
  /**
   * Warm the note pipeline's checkpoints up to this phase, then stop before saving anything.
   * The Inngest function runs one warm-up step per phase so each phase spends a fresh
   * invocation budget; the final full run replays them from cache in seconds.
   */
  stopAfter?: NotesGenerationPhase;
}) {
  // Before any state change or model call: a lecture that already burned through a day's worth of
  // generation attempts gets a terminal failure instead of another expensive loop.
  await assertLectureGenerationWithinBudget(params.lectureId);

  const { supabase, lecture } = await getLectureForPipeline(params);
  await updateLectureProcessingState({
    lectureId: lecture.id,
    processingMetadata: lecture.processing_metadata,
    stage: "generating_notes",
    durationSeconds: lecture.duration_seconds,
    title: lecture.title,
  });

  const manualImportMetadata =
    lecture.processing_metadata &&
    typeof lecture.processing_metadata === "object" &&
    !Array.isArray(lecture.processing_metadata) &&
    "manualImport" in lecture.processing_metadata
      ? (lecture.processing_metadata as Record<string, unknown>).manualImport
      : null;

  const manualImportRecord =
    manualImportMetadata && typeof manualImportMetadata === "object" && !Array.isArray(manualImportMetadata)
      ? (manualImportMetadata as Record<string, unknown>)
      : null;

  const { data: transcriptSegments, error: transcriptError } = await supabase
    .from("transcript_segments")
    .select("idx, start_ms, end_ms, speaker_label, text")
    .eq("lecture_id", lecture.id)
    .order("idx", { ascending: true });

  if (transcriptError) {
    throw transcriptError;
  }

  let storedSegments = (transcriptSegments ?? []) as Array<{
    idx: number;
    start_ms: number;
    end_ms: number;
    speaker_label: string | null;
    text: string;
  }>;

  if (storedSegments.length === 0 && manualImportRecord) {
    const manualText =
      typeof manualImportRecord.text === "string" ? manualImportRecord.text.trim() : "";
    const manualBlocks = Array.isArray(manualImportRecord.blocks)
      ? (manualImportRecord.blocks as StructuredSourceBlock[])
      : undefined;
    const manualSourceType =
      typeof manualImportRecord.sourceType === "string"
        ? manualImportRecord.sourceType
        : lecture.source_type ?? "text";

    const syntheticSegments = buildSyntheticTranscriptFromTextSource({
      text: manualText,
      blocks: manualBlocks,
      sourceType: manualSourceType,
    });

    if (syntheticSegments.length === 0) {
      throw new Error("Transcript is empty.");
    }

    const embeddings: number[][] = [];

    for (let start = 0; start < syntheticSegments.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = syntheticSegments.slice(start, start + EMBEDDING_BATCH_SIZE);
      embeddings.push(
        ...(await createEmbeddings(batch.map((segment: { text: string }) => segment.text))),
      );
    }

    const transcriptRows = syntheticSegments.map((segment, index) => ({
      lecture_id: lecture.id,
      idx: segment.idx,
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      speaker_label: segment.speakerLabel,
      text: segment.text,
      embedding: embeddings[index] ? serializeVector(embeddings[index]) : null,
    }));

    await insertTranscriptSegmentsInBatches(supabase, transcriptRows);

    if (manualText.length > 0) {
      await updateLectureProcessingState({
        lectureId: lecture.id,
        processingMetadata: lecture.processing_metadata,
        stage: "generating_notes",
        durationSeconds:
          lecture.duration_seconds ?? estimateTextSourceDurationSeconds(manualText),
      });
    }

    storedSegments = transcriptRows.map((segment) => ({
      idx: segment.idx,
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      speaker_label: segment.speaker_label,
      text: segment.text,
    }));
  }

  let segments = storedSegments.map((segment) => ({
    idx: segment.idx,
    startMs: segment.start_ms,
    endMs: segment.end_ms,
    speakerLabel: segment.speaker_label,
    text: segment.text,
  }));

  if (segments.length === 0) {
    throw new Error("Transcript is empty.");
  }

  // Text sources are compressed to the pipeline target before they are stored, but real audio
  // transcripts arrive here uncapped — an unusually long or dense recording can exceed what note
  // generation handles inside one step budget. Only the note input shrinks: the stored transcript,
  // its embeddings, chat and study features keep the full text.
  const transcriptChars = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  let transcriptCompression: Record<string, unknown> | null = null;

  if (transcriptChars > PIPELINE_SOURCE_TEXT_TARGET_CHARS) {
    // Checkpointed like every other stage in this step: selection is a model call, so replaying
    // it on an Inngest retry would both re-pay for it and hand the retry *different* condensed
    // text — which would silently invalidate every extraction checkpoint keyed on that text and
    // re-buy the whole pipeline, the exact loop the checkpoints exist to stop.
    const condensed = await withGenerationCheckpoint({
      lectureId: lecture.id,
      stage: "source_condense",
      cacheKey: generationCacheKey([
        stageModelCacheKeyPart("source_condense"),
        PIPELINE_SOURCE_TEXT_TARGET_CHARS,
        ...segments.map((segment) => segment.text),
      ]),
      schema: condensedTranscriptCheckpointSchema,
      generate: () =>
        condenseTranscriptForNotes({
          segments,
          targetChars: PIPELINE_SOURCE_TEXT_TARGET_CHARS,
          selector: createAiChunkSelector({
            stage: "source_condense",
            userId: lecture.user_id,
            lectureId: lecture.id,
          }),
        }),
    });

    // Condensation must never hand note generation nothing (a degenerate transcript whose every
    // unit overflows its budget can select zero units) and never meaningfully more than the
    // target the step budget is sized for.
    const condensedSegments =
      condensed.segments.length > 0
        ? condensed.segments
        : clampSegmentsToChars(segments, PIPELINE_SOURCE_TEXT_TARGET_CHARS);

    if (condensed.segments.length === 0) {
      console.warn(
        "[lecture-pipeline] Condensation kept no segments; using a mechanical prefix instead",
        { lectureId: lecture.id },
      );
    }

    segments = clampSegmentsToChars(
      condensedSegments,
      Math.round(PIPELINE_SOURCE_TEXT_TARGET_CHARS * 1.05),
    );
    transcriptCompression = { ...condensed.meta };
  }

  const sourceLabel =
    lecture.source_type === "audio"
      ? "lecture transcripts"
      : "uploaded documents and text sources";
  const pipelineName =
    lecture.source_type === "audio" ? "map-reduce-notes-v2" : "document-to-notes-v2";
  const sourceTitleHint =
    typeof lecture.title === "string" && lecture.title.trim().length > 0
      ? lecture.title
      : typeof manualImportRecord?.titleHint === "string"
        ? manualImportRecord.titleHint
        : undefined;

  const notes = await generateNotesFromTranscript(segments, {
    sourceLabel,
    pipelineName,
    sourceType: lecture.source_type === "audio" ? "audio" : "document",
    outputLanguage: lecture.language_hint,
    sourceTitleHint,
    usageContext: { lectureId: params.lectureId, userId: lecture.user_id },
    ...(params.stopAfter ? { stopAfter: params.stopAfter } : {}),
  });

  // A warm-up run stops here on purpose: the phase checkpoints are written and the finishing
  // steps — artifact save, images, audio, statuses — belong to the one authoritative full run.
  if (!notes) {
    return;
  }

  const manualModelMetadata =
    manualImportRecord?.modelMetadata &&
    typeof manualImportRecord.modelMetadata === "object" &&
    !Array.isArray(manualImportRecord.modelMetadata)
      ? (manualImportRecord.modelMetadata as Record<string, unknown>)
      : {};

  const baseModelMetadata = {
    ...notes.modelMetadata,
    ...manualModelMetadata,
    ...(transcriptCompression ? { transcriptCompression } : {}),
  };

  const { error: artifactError } = await supabase
    .from("lecture_artifacts")
    .upsert(
      {
        lecture_id: lecture.id,
        summary: notes.summary,
        key_topics: notes.keyTopics,
        structured_notes_md: notes.structuredNotesMd,
        model_metadata: withNoteEnrichmentStage(baseModelMetadata, "checking_document_images"),
      } as never,
      {
        onConflict: "lecture_id",
      },
    );

  if (artifactError) {
    throw artifactError;
  }

  await updateLectureProcessingState({
    lectureId: lecture.id,
    processingMetadata: lecture.processing_metadata,
    stage: "checking_document_images",
    durationSeconds: lecture.duration_seconds,
    title: notes.title,
  });

  const documentImages = getStoredDocumentImagesFromMetadata(manualModelMetadata);

  if (documentImages.length > 0) {
    // Placement runs after the notes are already saved, so failing here would throw away a
    // finished note over a picture that could not find its paragraph.
    try {
      await attachDocumentImagesToNotes({
        lectureId: lecture.id,
        structuredNotesMd: notes.structuredNotesMd,
        documentImages,
        usageContext: { lectureId: lecture.id, userId: lecture.user_id },
      });
    } catch (error) {
      console.warn("Placing document images failed; the note keeps its text.", error);
      captureBackgroundError(error, {
        operation: "document_image_placement",
        extra: { lectureId: lecture.id },
      });
    }
  }

  // The model's highlighter pass: best-effort like image placement, and it swallows its own
  // failures, so the finished note is never at risk over a decoration.
  await applyAiHighlightsToNote({
    lectureId: lecture.id,
    structuredNotesMd: notes.structuredNotesMd,
    lectureTitle: notes.title ?? lecture.title,
    usageContext: { lectureId: lecture.id, userId: lecture.user_id },
  });

  const { error: enrichmentCompleteError } = await supabase
    .from("lecture_artifacts")
    .update({
      model_metadata: withNoteEnrichmentStage(baseModelMetadata, "complete"),
    } as never)
    .eq("lecture_id", lecture.id);

  if (enrichmentCompleteError) {
    throw enrichmentCompleteError;
  }

  if (shouldCreateInitialNoteAudio(lecture.processing_metadata)) {
    await markInitialNoteAudioPreparing({
      lectureId: lecture.id,
      processingMetadata: lecture.processing_metadata,
    });
    await prepareInitialNoteTtsChunksSafely({
      userId: lecture.user_id,
      lectureId: lecture.id,
      content: notes.structuredNotesMd,
      title: notes.title,
      languageHint: lecture.language_hint,
      voice: getInitialNoteAudioVoice(lecture.processing_metadata),
    });
  }

  await updateLectureProcessingState({
    lectureId: lecture.id,
    processingMetadata: lecture.processing_metadata,
    stage: "ready",
    title: notes.title,
    durationSeconds: lecture.duration_seconds,
  });

  // The checkpoints exist to make retries of an unfinished generation cheap; once the lecture is
  // ready they are dead weight, and clearing here is what keeps the cache table bounded.
  await clearGenerationCache(lecture.id);
}

/**
 * Records a pipeline failure on the lecture row. Returns `{ recorded: false }` when there was no
 * failure left to record — the notes were already finished and the lecture was left ready, the
 * learner deleted the lecture out from under the run, or the overrun was handed to an automatic
 * retry and the row went back to "queued". A caller that would otherwise rethrow should treat all
 * three as a success: retrying buys nothing in any of them.
 */
export async function markLecturePipelineFailed(params: {
  lectureId: string;
  error: unknown;
}) {
  const { data: lecture, error: lectureLookupError } = await createSupabaseServiceRoleClient()
    .from("lectures")
    .select("processing_metadata, source_type, user_id, language_hint, storage_path")
    .eq("id", params.lectureId)
    .maybeSingle();

  // The learner deleted the lecture while it was still processing, so the run that just failed
  // was working on something nobody is waiting for any more. There is no row to mark failed and
  // no status anyone will read, and the failure capture has nothing to snapshot either — the
  // source went with the lecture, so it wrote an orphan row of nulls that then sat there for
  // thirty days. An abandoned run is an ordinary outcome, not a defect, so it stays out of Sentry
  // and leaves only the structured platform-log line.
  //
  // Only a lookup that *succeeded* and came back empty proves the row is gone. A lookup that
  // errored also leaves `lecture` null, and that is a real failure that must still be recorded —
  // which is why the error is read here rather than discarded as it used to be.
  if (!lectureLookupError && !lecture) {
    console.warn("[lecture-pipeline] Lecture was deleted while it was still processing", {
      lectureId: params.lectureId,
      error: toErrorMessage(params.error),
    });

    return { recorded: false };
  }

  const lectureMetadata = lecture as {
    processing_metadata?: unknown;
    source_type?: string | null;
    user_id?: string | null;
    language_hint?: string | null;
    storage_path?: string | null;
  } | null;
  const metadata = parseProcessingMetadata(lectureMetadata?.processing_metadata);
  const transcriptionDiagnostics = getTranscriptionDiagnostics(params.error);
  const scanOcrDiagnostics = getScanOcrDiagnostics(params.error);
  const nextMetadata = transcriptionDiagnostics || scanOcrDiagnostics
    ? {
        ...metadata,
        ...(transcriptionDiagnostics ? { transcription: transcriptionDiagnostics } : {}),
        ...(scanOcrDiagnostics ? { scanOcr: scanOcrDiagnostics } : {}),
      }
    : metadata;
  const manualImport =
    metadata.manualImport && typeof metadata.manualImport === "object" && !Array.isArray(metadata.manualImport)
      ? (metadata.manualImport as Record<string, unknown>)
      : null;
  const modelMetadata =
    manualImport?.modelMetadata &&
    typeof manualImport.modelMetadata === "object" &&
    !Array.isArray(manualImport.modelMetadata)
      ? (manualImport.modelMetadata as Record<string, unknown>)
      : null;
  const sourceUrl = typeof modelMetadata?.sourceUrl === "string" ? modelMetadata.sourceUrl : null;
  let sourceHost: string | undefined;

  if (sourceUrl) {
    try {
      sourceHost = new URL(sourceUrl).hostname;
    } catch {
      sourceHost = undefined;
    }
  }

  // The notes are already written and the artifact already marked complete before the optional
  // initial audio starts, which is why `prepareInitialNoteTtsChunksSafely` swallows its own
  // failures. The invocation budget is the one thing that still escapes it: it rejects the caller's
  // `Promise.race`, not the pipeline, so a deadline reached during that optional step arrives here
  // and buries a finished lecture under "processing failed" — where `reconcileLectureWithArtifact`
  // will never rescue it, because it refuses to touch a failed row. Nothing the learner is waiting
  // for is outstanding at this stage, so keep the lecture ready and let the note player prepare its
  // first audio chunk on demand.
  if (isPreparingInitialNoteAudio(metadata)) {
    console.warn("Lecture pipeline failed after the notes were finished", {
      lectureId: params.lectureId,
      error: params.error,
    });

    await updateLectureProcessingState({
      lectureId: params.lectureId,
      processingMetadata: nextMetadata,
      stage: "ready",
    });

    return { recorded: false };
  }

  // Every lecture that ends up failed leaves one structured, searchable line in the platform log
  // — `vercel logs` filtered on "[lecture-pipeline]" is the operational view. Expected input
  // failures (no speech in the recording, unreadable scan) are the learner's material, not a
  // defect, so they log at warn and stay out of Sentry. Everything else logs at error and
  // reaches Sentry — including AI errors that would have been retryable in the moment: by the
  // time a lecture is being marked failed the retries are spent, and "the provider timed out
  // until we gave up" is exactly the kind of failure the team wants an alert for. The old
  // !isRetryableAiError guard silently dropped every one of the 2026-08-25 outline-timeout
  // failures.
  const expectedInputFailure = isExpectedLectureInputFailure(params.error);
  // A run that died on the invocation budget was healthy and simply ran out of time, and every
  // stage it finished is checkpointed — the next run pays only for what is left (measured on the
  // 2026-08-27 overrun: 80 seconds). The learner's retry button would fix it; they should not
  // have to find it. That lecture sat failed for 3.6 hours until its owner came back and pressed
  // the button themselves, so the pipeline now presses it: the failure is still recorded
  // honestly, then the same job the manual retry route would start is started automatically.
  //
  // Bounded by MAX_BUDGET_FAILURE_RUNS. A source that dies on the budget run after run, with
  // checkpoints accumulating the whole time, has demonstrated — not merely suggested — that it
  // cannot be processed in one piece; that terminal case is handled below.
  const budgetOverrun = isBudgetOverrunFailure(params.error);
  const budgetFailureRuns = budgetOverrun ? readBudgetFailureCount(metadata) + 1 : 0;

  if (budgetOverrun && budgetFailureRuns < MAX_BUDGET_FAILURE_RUNS) {
    let retried = false;

    try {
      // The learner sees an uninterrupted spinner, not a failure that un-fails itself: the row
      // goes back to "queued" — the same touch the stuck-lecture recovery in the lecture GET
      // writes — with the failure counter bumped and processing.updatedAt refreshed. The fresh
      // timestamp restarts that recovery's staleness clock, which is also the safety net here:
      // if the retry run below dies without ever reaching this function again, the lecture is a
      // stale "queued" row, and opening it re-enqueues the right job for every source shape.
      //
      // Touched before enqueueing, not after: on the HTTP-fallback tier the enqueue can run the
      // whole job inline, and a touch written after it would stamp "queued" over the finished
      // lecture with no recovery path left to fix it.
      await createSupabaseServiceRoleClient()
        .from("lectures")
        .update(
          sanitizeJsonForDatabase({
            status: "queued",
            error_message: null,
            processing_metadata: {
              ...nextMetadata,
              [BUDGET_FAILURE_COUNT_KEY]: budgetFailureRuns,
              [LECTURE_FAILURE_METADATA_KEY]: { code: null },
              processing: {
                ...(typeof (nextMetadata as Record<string, unknown>).processing === "object"
                  ? ((nextMetadata as Record<string, unknown>).processing as Record<string, unknown>)
                  : {}),
                stage: "queued",
                updatedAt: new Date().toISOString(),
                errorMessage: null,
              },
            },
          }) as never,
        )
        .eq("id", params.lectureId);

      retried = await enqueueBudgetOverrunRetry({
        lectureId: params.lectureId,
        sourceType: lectureMetadata?.source_type ?? null,
        metadata,
      });
    } catch (retryError) {
      console.error("Automatic budget-overrun retry could not be started", {
        lectureId: params.lectureId,
        error: retryError,
      });
    }

    if (retried) {
      // No "[lecture-pipeline]" prefix on purpose: the triage automation treats every line
      // carrying that prefix as actionable, and a failure the pipeline is already retrying by
      // itself is not. It stays a warn so the platform log still shows the struggle.
      console.warn("Lecture run died on the invocation budget; retrying automatically", {
        lectureId: params.lectureId,
        budgetFailureRuns,
        maxRuns: MAX_BUDGET_FAILURE_RUNS,
        error: toErrorMessage(params.error),
      });

      // Nothing was recorded: the row is "queued" with its error_message cleared, no Sentry event
      // was sent and no failure capture was written. Saying otherwise makes the Inngest bodies
      // rethrow — the run that just healed itself is reported to the platform as a failed one, and
      // the uncaught budget error on POST /api/inngest wakes the triage automation for a lecture
      // that is already being retried. That is the 2026-08-29T07:32 pair in the platform log:
      // "retrying automatically" for lecture b11aa158, then the same sentence again as an uncaught
      // error 2.5 seconds later, from a run whose retry went on to succeed.
      //
      // This branch returned `recorded: true` honestly until the intermediate state became
      // "queued": before that it really did mark the lecture failed first. The write changed; this
      // did not.
      return { recorded: false };
    }

    // The retry could not be started, so this lecture is waiting on a human after all. Falling
    // through records the failure with everything an unretried one always had: the failed
    // status and message (undoing the optimistic "queued" above), the log line, the Sentry
    // event, and the retry button — the failure code below stays null for a non-terminal
    // overrun, and null codes keep the button.
  }

  // The terminal budget case: this run was the lecture's last chance and it died on the budget
  // again. The learner's message stops promising that trying again will help — it will not, and
  // the "source_too_large" code (already in the unretryable set) takes the retry button with it.
  const budgetRetriesExhausted = budgetOverrun && budgetFailureRuns >= MAX_BUDGET_FAILURE_RUNS;
  const learnerMessage = budgetRetriesExhausted
    ? AI_SOURCE_TOO_EXTENSIVE_MESSAGE
    : toErrorMessage(params.error);
  const failureCode = budgetRetriesExhausted
    ? "source_too_large"
    : toLectureFailureCode(params.error);

  const logPayload = {
    lectureId: params.lectureId,
    userId: lectureMetadata?.user_id ?? null,
    sourceType: lectureMetadata?.source_type ?? null,
    error: toErrorMessage(params.error),
  };

  if (expectedInputFailure) {
    console.warn("[lecture-pipeline] Lecture failed on its own input", logPayload);
  } else {
    console.error("[lecture-pipeline] Lecture failed", logPayload);
  }

  if (!expectedInputFailure) {
    captureRouteError(params.error, {
      route: "lecture-pipeline",
      operation: "markLecturePipelineFailed",
      lectureId: params.lectureId,
      userId: lectureMetadata?.user_id ?? undefined,
      tags: {
        sourceType: lectureMetadata?.source_type ?? "unknown",
        ...(sourceHost ? { sourceHost } : {}),
      },
      extra: {
        manualSourceType: typeof manualImport?.sourceType === "string" ? manualImport.sourceType : null,
        sourceTextLength: typeof manualImport?.text === "string" ? manualImport.text.length : null,
        processing: metadata.processing ?? null,
        scanOcr: scanOcrDiagnostics,
        transcription: transcriptionDiagnostics,
      },
    });
  }

  // Record what kind of failure this was, not just its wording. Both surfaces that render a
  // failure use it to drop the retry button where retry cannot clear the cause — a link behind a
  // sign-in, a recording with no speech — since offering it there only sends the learner round
  // the same loop. Written on every failure, so a later one carrying no code clears an earlier
  // code rather than leaving it to be read as current.
  await updateLectureProcessingState({
    lectureId: params.lectureId,
    processingMetadata: {
      ...nextMetadata,
      // The exhausted count is kept on the row on purpose: if a learner retries a lecture the
      // pipeline has already called too extensive and it overruns again, it goes straight back
      // to terminal instead of winning three more automatic runs.
      ...(budgetOverrun ? { [BUDGET_FAILURE_COUNT_KEY]: budgetFailureRuns } : {}),
      [LECTURE_FAILURE_METADATA_KEY]: { code: failureCode },
    },
    stage: "failed",
    errorMessage: learnerMessage,
  });

  // Snapshot the exact input this lecture failed on, so the triage automation can reproduce the
  // failure with the user's real material instead of reasoning from the stack trace. The raw
  // error goes in the capture — the user-facing message above is written for the learner.
  await captureGenerationFailureInput({
    lectureId: params.lectureId,
    userId: lectureMetadata?.user_id ?? null,
    sourceType: lectureMetadata?.source_type ?? null,
    languageHint: lectureMetadata?.language_hint ?? null,
    errorMessage:
      params.error instanceof Error ? params.error.message : String(params.error),
    processingMetadata: lectureMetadata?.processing_metadata ?? null,
    storagePath: lectureMetadata?.storage_path ?? null,
  });

  return { recorded: true };
}

/**
 * Runs one pipeline stage inside its Inngest step, so a failure that is the recording itself is
 * recognised on the throwing side of the step boundary.
 *
 * Inngest only hands the error to the function body once the step has spent its retries, and by
 * then it is a `StepError` rebuilt from `{ name: "Error", message, stack }`. markLecturePipelineFailed
 * cannot tell a silent recording from a defect through that, so it reports one to Sentry with a
 * lecture whose learner has already been told to check their audio, and the rethrow that follows
 * fails the run — the uncaught `Error: V zvoku ni bilo mogoče zaznati dovolj jasnega govora` on
 * POST /api/inngest. Recording the failure here also lets the step succeed, so Inngest stops
 * retrying a transcription that will never find speech that is not in the file.
 *
 * Anything else — a retryable AI error, a broken query, a timeout — still throws, and still fails
 * the step so it can be retried and reported.
 */
export async function runLectureStage(params: {
  lectureId: string;
  run: () => Promise<void>;
}): Promise<{ completed: boolean }> {
  try {
    await params.run();

    return { completed: true };
  } catch (error) {
    if (!isExpectedLectureInputFailure(error)) {
      throw error;
    }

    await markLecturePipelineFailed({
      lectureId: params.lectureId,
      error,
    });

    return { completed: false };
  }
}

export async function runLecturePipeline(params: { lectureId: string }) {
  try {
    await transcribeLectureContent(params);
    await generateLectureNotesFromStoredTranscript(params);
  } catch (error) {
    await markLecturePipelineFailed({
      lectureId: params.lectureId,
      error,
    });

    throw error;
  }
}

type RpcMatchResult = {
  id: string;
  lecture_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker_label: string | null;
  text: string;
  similarity: number;
};

export async function answerLectureChat(params: {
  lectureId: string;
  userId: string;
  question: string;
}) {
  const supabase = createSupabaseServiceRoleClient();

  const [{ data: artifact }, { data: lecture }, embeddingResponse] = await Promise.all([
    supabase
      .from("lecture_artifacts")
      .select("*")
      .eq("lecture_id", params.lectureId)
      .maybeSingle(),
    supabase
      .from("lectures")
      .select("language_hint")
      .eq("id", params.lectureId)
      .maybeSingle(),
    createEmbeddings([params.question]),
  ]);

  const queryEmbedding = serializeVector(embeddingResponse[0]);
  const artifactRow = (artifact ?? null) as {
    summary: string;
    key_topics: string[];
  } | null;
  const lectureRow = (lecture ?? null) as { language_hint: string | null } | null;

  const { data: matches, error: matchError } = await supabase.rpc(
    "match_transcript_segments" as never,
    {
      filter_lecture_id: params.lectureId,
      match_count: CHAT_MATCH_COUNT,
      query_embedding: queryEmbedding,
    } as never,
  );

  if (matchError) {
    throw matchError as PostgrestError;
  }

  const context = (matches ?? []) as RpcMatchResult[];

  const answer = await generateStructuredObject({
    schema: chatAnswerSchema,
    stage: "chat",
    instructions: `${buildGeneratedContentLanguageInstruction(lectureRow?.language_hint)} Answer the student using only the supplied lecture context. If the answer is not fully supported, say that the lecture does not clearly state it. Cite only transcript chunks that are genuinely relevant.`,
    input: JSON.stringify(
      {
        question: params.question,
        summary: artifactRow?.summary ?? null,
        keyTopics: artifactRow?.key_topics ?? [],
        context,
      },
      null,
      2,
    ),
  });

  const citations = answer.citations.map((citation) => ({
    idx: citation.idx,
    startMs: citation.startMs,
    endMs: citation.endMs,
    quote: citation.quote,
  }));

  const userMessage = {
    lecture_id: params.lectureId,
    user_id: params.userId,
    role: "user" as const,
    content: params.question,
    citations_json: [],
  };

  const assistantMessage = {
    lecture_id: params.lectureId,
    user_id: params.userId,
    role: "assistant" as const,
    content: answer.answer,
    citations_json: citations,
  };

  const { data: insertedMessages, error: insertError } = await supabase
    .from("chat_messages")
    .insert([userMessage, assistantMessage] as never)
    .select("*");

  if (insertError) {
    throw insertError;
  }

  const persistedMessages = (insertedMessages ?? []) as Array<{
    id: string;
    lecture_id: string;
    user_id: string;
    role: "user" | "assistant";
    content: string;
    citations_json: unknown;
    created_at: string;
  }>;

  const mapped = persistedMessages.map((message) => ({
    ...message,
    citations: Array.isArray(message.citations_json)
      ? (message.citations_json as unknown as ChatMessageWithCitations["citations"])
      : [],
  }));

  return {
    answer: mapped.find((message) => message.role === "assistant") ?? null,
    context,
  };
}
