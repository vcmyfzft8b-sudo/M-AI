import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";

import { toUserFacingAiErrorMessage } from "@/lib/ai/errors";
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
import { isExpectedLectureInputFailure } from "@/lib/lecture-processing-errors";
import { buildGeneratedContentLanguageInstruction } from "@/lib/languages";
import {
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
import { generateNotesFromTranscript } from "@/lib/note-generation";
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
  const metadata = parseProcessingMetadata(params.processingMetadata);
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
    .single();

  if (lectureError) {
    throw lectureError;
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

export async function generateLectureNotesFromStoredTranscript(params: { lectureId: string }) {
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
  });

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
      });
    } catch (error) {
      console.warn("Placing document images failed; the note keeps its text.", error);
      captureBackgroundError(error, {
        operation: "document_image_placement",
        extra: { lectureId: lecture.id },
      });
    }
  }

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
 * Records a pipeline failure on the lecture row. Returns `{ recorded: false }` when the failure
 * arrived too late to matter — the notes were already finished — and the lecture was left ready
 * instead; a caller that would otherwise rethrow should treat that as a success.
 */
export async function markLecturePipelineFailed(params: {
  lectureId: string;
  error: unknown;
}) {
  const { data: lecture } = await createSupabaseServiceRoleClient()
    .from("lectures")
    .select("processing_metadata, source_type, user_id, language_hint")
    .eq("id", params.lectureId)
    .maybeSingle();

  const lectureMetadata = lecture as {
    processing_metadata?: unknown;
    source_type?: string | null;
    user_id?: string | null;
    language_hint?: string | null;
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

  await updateLectureProcessingState({
    lectureId: params.lectureId,
    processingMetadata: nextMetadata,
    stage: "failed",
    errorMessage: toErrorMessage(params.error),
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
