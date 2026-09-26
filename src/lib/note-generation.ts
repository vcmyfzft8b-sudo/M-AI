import "server-only";
import { repairWrittenNote } from "@/lib/ai/language-check";
import { resolveSourceLanguage } from "@/lib/source-language";

import { chunkSummarySchema, noteArtifactSchema } from "@/lib/ai/schemas";
import { generateStructuredObject } from "@/lib/ai/json";
import { getServerEnv } from "@/lib/server-env";
import { buildTranscriptWindows } from "@/lib/chunking";
import { buildGeneratedContentLanguageInstruction, detectSourceLanguage } from "@/lib/languages";
import {
  buildKnowledgeExtractionInstructions,
  buildLegacyAudioNoteTargets,
  buildLegacyNoteTargets,
  buildLegacyStructuredPlusInstructions,
  assembleSourceNoteParts,
  buildNoteOutlineInstructions,
  buildSourceNoteInstructions,
  countWords,
  dedupeKnowledgeItems,
  planSourceWriteWindows,
  KNOWLEDGE_EXTRACTION_PASS_WINDOWS,
  MAX_ITEMS_PER_EXTRACTION_WINDOW,
  resolveExtractionMaxOutputTokens,
  knowledgeExtractionSchema,
  MATH_FORMATTING_INSTRUCTIONS,
  enforceOutlineRetentionBounds,
  noteOutlineSchema,
  noteWriteSchema,
  normalizeGeneratedNoteMarkdown,
  normalizeNoteCalloutLanguage,
  splitTextForExtraction,
  type IndexedKnowledgeItem,
} from "@/lib/notes/note-prompts";
import {
  generationCacheKey,
  loadGenerationCacheEntries,
  saveGenerationCacheEntry,
  stageModelCacheKeyPart,
  withGenerationCheckpoint,
} from "@/lib/notes/generation-cache";
import { judgeCollapseDuplicateItems } from "@/lib/study-items";
import type { NoteGenerationResult, TranscriptSegmentInput } from "@/lib/types";
import { expectedInputFailure } from "@/lib/lecture-failure-text";
import {
  buildTopicStudyTextInput,
  buildTopicStudyTextInstructions,
  countTopicStudyTextWords,
  MIN_TOPIC_STUDY_TEXT_WORDS,
  shouldWriteTopicNotes,
  topicStudyTextSchema,
  type TopicMaterialKind,
} from "@/lib/notes/topic-notes";

const NOTE_CHUNK_SUMMARY_CONCURRENCY = 2;
// 8 workers, not 3: the extraction phase has to fit inside the Inngest step budget alongside the
// outline and the write, and at 3 workers a large source spent the whole budget on extraction
// alone. The windows are small and flash-lite's rate limits sit far above this.
const NOTE_EXTRACTION_CONCURRENCY = 8;

/**
 * "content" is the measured default: extract every testable claim, outline what the note keeps,
 * then write exactly that (evals/, scripts/note-eval.mjs). "legacy" restores the previous
 * chunk-summary pipeline as a production rollback switch, not a supported mode.
 */
function resolveNotesPipelineMode() {
  return process.env.NOTES_PIPELINE?.trim().toLowerCase() === "legacy" ? "legacy" : "content";
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

/* -------------------------------------------------------------------------- */
/* Content-driven pipeline (default)                                          */
/* -------------------------------------------------------------------------- */

type ExtractionWindow = {
  passIndex: number;
  label: string;
  text: string;
};

// buildTranscriptWindows sizes by characters; the measured pass sizes are in words.
const APPROX_CHARS_PER_WORD = 6.5;

function buildExtractionWindows(segments: TranscriptSegmentInput[]): ExtractionWindow[] {
  return KNOWLEDGE_EXTRACTION_PASS_WINDOWS.flatMap((windowWords, passIndex) => {
    const maxChars = Math.round(windowWords * APPROX_CHARS_PER_WORD);
    // buildTranscriptWindows never splits a single oversized segment, and transcription can hand
    // back one segment covering the whole recording — split those here or the extraction budget
    // cannot fit the window's claims.
    const texts = buildTranscriptWindows(segments, maxChars).flatMap((window) =>
      splitTextForExtraction(window.text, maxChars),
    );

    return texts.map((text, index) => ({
      passIndex,
      label: `Chunk ${index + 1} of ${texts.length}`,
      text,
    }));
  });
}

/**
 * Reads the source twice at different granularities and merges. One pass is not stable — the same
 * source yields visibly different item counts run to run — and everything downstream is capped by
 * what extraction catches. A claim straddling a window boundary in one pass sits inside a window
 * in the other; duplicates collapse in the merge. Repeats are only importance evidence within a
 * single pass; across passes every claim is expected twice and a boost would flatten the scale.
 */
export async function extractKnowledgeItems(params: {
  segments: TranscriptSegmentInput[];
  sourceType: "audio" | "document";
  outputLanguage?: string | null;
  usageContext?: { userId?: string | null; lectureId?: string | null };
}): Promise<IndexedKnowledgeItem[]> {
  const windows = buildExtractionWindows(params.segments);
  const instructions = buildKnowledgeExtractionInstructions({
    outputLanguage: params.outputLanguage,
    sourceType: params.sourceType,
  });

  // Checkpoints from a previous attempt at this same lecture: the step budget can end a run
  // mid-extraction, and the Inngest retry that follows must pay only for the windows the earlier
  // attempt did not finish, not for the whole source again. Keys are computed up front so the
  // lookup fetches exactly the rows that can hit — never "everything for the stage".
  const lectureId = params.usageContext?.lectureId ?? null;
  const modelKeyPart = stageModelCacheKeyPart("note_extract");
  const windowPlans = windows.map((window) => {
    const maxOutputTokens = resolveExtractionMaxOutputTokens(countWords(window.text));

    return {
      window,
      maxOutputTokens,
      cacheKey: generationCacheKey([
        modelKeyPart,
        instructions,
        window.label,
        window.text,
        maxOutputTokens,
      ]),
    };
  });
  const cachedWindows = lectureId
    ? await loadGenerationCacheEntries({
        lectureId,
        stage: "note_extract",
        cacheKeys: windowPlans.map((plan) => plan.cacheKey),
      })
    : new Map<string, unknown>();

  const extractions = await mapWithConcurrency(
    windowPlans,
    NOTE_EXTRACTION_CONCURRENCY,
    async ({ window, maxOutputTokens, cacheKey }) => {
      const cached = knowledgeExtractionSchema.safeParse(cachedWindows.get(cacheKey));

      const extraction = cached.success
        ? cached.data
        : await generateStructuredObject({
            schema: knowledgeExtractionSchema,
            maxOutputTokens,
            stage: "note_extract",
            instructions,
            input: `${window.label}.\n\n${window.text}`,
            usageContext: params.usageContext,
          });

      if (!cached.success && lectureId) {
        await saveGenerationCacheEntry({
          lectureId,
          stage: "note_extract",
          cacheKey,
          payload: extraction,
        });
      }

      // Bounded here as well as in the instructions: a model that ignores the limit would
      // otherwise hand the outline a shredded chunk to triage.
      return {
        ...extraction,
        items: extraction.items.slice(0, MAX_ITEMS_PER_EXTRACTION_WINDOW),
        passIndex: window.passIndex,
      };
    },
  );

  const byPass = new Map<number, IndexedKnowledgeItem[]>();

  for (const extraction of extractions) {
    const items = extraction.items.map((item, id) => ({
      ...item,
      id,
      sectionTitle: extraction.sectionTitle,
    }));
    byPass.set(extraction.passIndex, [...(byPass.get(extraction.passIndex) ?? []), ...items]);
  }

  const perPass = [...byPass.values()].flatMap((items) =>
    dedupeKnowledgeItems(
      items.map((item, id) => ({ ...item, id })),
      { boostRepeats: true },
    ),
  );

  const merged = dedupeKnowledgeItems(perPass.map((item, id) => ({ ...item, id })));
  const judged = await judgeCollapseDuplicateItems(
    merged.map((item, id) => ({ ...item, id })),
    params.usageContext,
  );

  return judged.map((item, id) => ({ ...item, id }));
}

/**
 * Above this many extracted items the outline runs on GEMINI_TEXT_MODEL instead of the stage's
 * default. The outline is the one call that cannot be windowed — it is the single place global
 * importance is judged, over every item at once — and its output grows with the item count
 * (~60 tokens each). The default writer since 2026-08-28 reasons at ~50-80 tokens/s, so past
 * ~120 items the call stops fitting the 300s invocation it runs in, and a call that cannot fit
 * is a call that can never converge, no matter how many times Inngest retries it. The fast
 * proven Gemini outline (the pre-switch production model) takes over exactly there.
 */
const OUTLINE_SIZE_GATE_MAX_ITEMS = 120;

/**
 * The phases an Inngest warm-up step can stop after. Each phase is checkpointed, so a later step
 * that re-enters the pipeline replays everything up to here in seconds and spends its own fresh
 * invocation budget on the phases that remain — which is what gives a slow model more wall clock
 * than any single 300s invocation can.
 */
export type NotesGenerationPhase = "note_extract" | "note_outline";

// The model-detected source language is authoritative; never invent an app-locale default.
function resolveNoteLabelLanguage(sourceText: string, outputLanguage?: string | null) {
  return outputLanguage ?? detectSourceLanguage(sourceText);
}

async function generateNotesContentDriven(
  segments: TranscriptSegmentInput[],
  params: {
    sourceLabel: string;
    pipelineName: string;
    sourceType: "audio" | "document";
    outputLanguage?: string | null;
    sourceTitleHint?: string | null;
    /** Warm the checkpoints up to this phase and return null instead of a finished note. */
    stopAfter?: NotesGenerationPhase;
    usageContext?: { userId?: string | null; lectureId?: string | null };
  },
): Promise<NoteGenerationResult | null> {
  const sourceWordCount = segments.reduce((total, segment) => total + countWords(segment.text), 0);
  const lectureId = params.usageContext?.lectureId ?? null;
  let items = await extractKnowledgeItems({
    segments,
    sourceType: params.sourceType,
    outputLanguage: params.outputLanguage,
    usageContext: params.usageContext,
  });
  let noteSegments = segments;
  let topicNotes: { materialKind: TopicMaterialKind; topicTitle: string } | null = null;

  // Material that names a topic but explains none of it -- an exercise sheet, a spoken question, a
  // list of terms -- is taught as that topic instead of failing (notes/topic-notes.ts). The study
  // text is checkpointed, so every Inngest step replays the same text, and the extraction over it
  // is checkpointed per window like any other source.
  if (shouldWriteTopicNotes({ itemCount: items.length, sourceWordCount })) {
    const sourceText = segments.map((segment) => segment.text).join("\n\n");
    const topicInstructions = buildTopicStudyTextInstructions({
      outputLanguage: params.outputLanguage,
    });
    const topicInput = buildTopicStudyTextInput({
      sourceText,
      sourceType: params.sourceType,
      titleHint: params.sourceTitleHint,
    });
    const topicMaxOutputTokens = 6000;
    const topic = await withGenerationCheckpoint({
      lectureId,
      stage: "note_topic",
      cacheKey: generationCacheKey([
        stageModelCacheKeyPart("note_topic"),
        topicInstructions,
        topicInput,
        topicMaxOutputTokens,
      ]),
      schema: topicStudyTextSchema,
      generate: () =>
        generateStructuredObject({
          schema: topicStudyTextSchema,
          maxOutputTokens: topicMaxOutputTokens,
          stage: "note_topic",
          instructions: topicInstructions,
          input: topicInput,
          usageContext: params.usageContext,
        }),
    });
    const studyText = topic.studyText.trim();

    if (topic.hasStudyTopic && countTopicStudyTextWords(studyText) >= MIN_TOPIC_STUDY_TEXT_WORDS) {
      noteSegments = [
        { idx: 0, startMs: 0, endMs: 0, speakerLabel: null, text: studyText },
      ];
      items = await extractKnowledgeItems({
        segments: noteSegments,
        sourceType: "document",
        outputLanguage: params.outputLanguage,
        usageContext: params.usageContext,
      });
      topicNotes = { materialKind: topic.materialKind, topicTitle: topic.topicTitle.trim() };
    }
  }

  // Nothing to teach even as a topic: a blank form, a photo with nothing on it, a greeting. That
  // is the learner's material, not a defect, and the retry button stays off because a retry
  // replays the same checkpointed verdict.
  if (items.length === 0) {
    throw expectedInputFailure("source_no_study_content");
  }

  if (params.stopAfter === "note_extract") {
    return null;
  }

  const outlineInstructions = buildNoteOutlineInstructions({ outputLanguage: params.outputLanguage });
  // Compact JSON on purpose: this is the largest prompt in the pipeline (every extracted item),
  // and pretty-printing it was pure token overhead on a call that already fights its timeout.
  const outlineInput = JSON.stringify({
    sourceType: topicNotes ? "document" : params.sourceType,
    sourceLabel: params.sourceLabel,
    sourceTitleHint: topicNotes?.topicTitle || params.sourceTitleHint || null,
    items: items.map(({ id, claim, kind, importance, sectionTitle }) => ({
      id,
      claim,
      kind,
      importance,
      sectionTitle,
    })),
  });
  const outlineMaxOutputTokens = Math.max(2600, items.length * 60);

  // The gate model rides OpenRouter like everything else (2026-08-29); the fallback chain in
  // json.ts still lands it on direct Google if the gateway is the problem.
  const gateModel = getServerEnv().GEMINI_TEXT_MODEL;
  const outlineModelOverride =
    items.length > OUTLINE_SIZE_GATE_MAX_ITEMS
      ? /^gemini-/i.test(gateModel)
        ? `or/google/${gateModel}`
        : gateModel
      : undefined;

  const rawOutline = await withGenerationCheckpoint({
    lectureId,
    stage: "note_outline",
    cacheKey: generationCacheKey([
      stageModelCacheKeyPart("note_outline", outlineModelOverride),
      outlineInstructions,
      outlineInput,
      outlineMaxOutputTokens,
    ]),
    schema: noteOutlineSchema,
    generate: () =>
      generateStructuredObject({
        schema: noteOutlineSchema,
        maxOutputTokens: outlineMaxOutputTokens,
        stage: "note_outline",
        instructions: outlineInstructions,
        input: outlineInput,
        ...(outlineModelOverride ? { modelOverride: outlineModelOverride } : {}),
        usageContext: params.usageContext,
      }),
  });

  if (params.stopAfter === "note_outline") {
    return null;
  }

  // The model chooses; the bounds on that choice are mechanical. See the function's own comment.
  const outline = enforceOutlineRetentionBounds(rawOutline, items);
  const retainedItemCount = outline.topics.reduce(
    (total, topic) => total + topic.itemIds.length,
    0,
  );
  const sourceText = noteSegments.map((segment) => segment.text).join("\n\n");

  // The note is written straight from the raw source (buildSourceNoteInstructions carries the
  // whole contract — the outline above still feeds the study decks and the note's title, but the
  // note text no longer passes through it). One call when the source fits, consecutive source
  // parts when it does not; each part is checkpointed separately, so a step that dies mid-note
  // resumes after the parts already written — the same convergence contract extraction has.
  const sourceWindows = planSourceWriteWindows(sourceText);
  const windowMarkdowns: string[] = [];

  const labelLanguage = resolveNoteLabelLanguage(sourceText, params.outputLanguage);

  for (const [windowIndex, sourceWindow] of sourceWindows.entries()) {
    const writeInstructions = buildSourceNoteInstructions({
      outputLanguage: labelLanguage,
      ...(sourceWindows.length > 1
        ? { window: { index: windowIndex, count: sourceWindows.length } }
        : {}),
    });
    const writeInput =
      sourceWindows.length > 1 && windowIndex > 0
        ? `Topic of the whole document: ${outline.title}\n\nSource material (part ${windowIndex + 1} of ${sourceWindows.length}):\n${sourceWindow}`
        : sourceWindow;
    // Sized from the part's own length: the contract caps the note at ~60% of the source, and
    // Slovene runs ~2.3 tokens per word, so 1.6x words is that ceiling plus slack — small enough
    // that a runaway part still cannot outlive the write leash.
    const writeMaxOutputTokens = Math.max(4000, Math.round(countWords(sourceWindow) * 1.6));

    // Checkpointed like the outline: this is the single most expensive call in the product, and a
    // budget that expires after the write but before the artifact is saved must not re-buy it.
    const written = await withGenerationCheckpoint({
      lectureId,
      stage: "note_write",
      cacheKey: generationCacheKey([
        stageModelCacheKeyPart("note_write"),
        writeInstructions,
        writeInput,
        writeMaxOutputTokens,
      ]),
      schema: noteWriteSchema,
      generate: () =>
        generateStructuredObject({
          schema: noteWriteSchema,
          maxOutputTokens: writeMaxOutputTokens,
          stage: "note_write",
          instructions: writeInstructions,
          input: writeInput,
          usageContext: params.usageContext,
        }),
    });

    windowMarkdowns.push(await repairWrittenNote({
      text: normalizeGeneratedNoteMarkdown(written.structuredNotesMd).trim(),
      language: labelLanguage, usageContext: params.usageContext,
    }));
  }

  const normalizedStructuredNotesMd = normalizeNoteCalloutLanguage(normalizeGeneratedNoteMarkdown(
    assembleSourceNoteParts(windowMarkdowns),
  ), labelLanguage);
  const normalizedNoteWordCount = countWords(normalizedStructuredNotesMd);

  return {
    title: outline.title,
    emoji: outline.emoji ?? null,
    summary: outline.summary,
    keyTopics: outline.keyTopics,
    structuredNotesMd: normalizedStructuredNotesMd,
    modelMetadata: {
      pipeline: params.pipelineName,
      notesMode: topicNotes ? "topic" : "content",
      // Read by the note screen to tell the learner what happened: their material held exercises
      // or a question rather than an explanation, so the note teaches the topic it points at.
      ...(topicNotes ? { topicNotes } : {}),
      // The extracted items travel with the artifact so study generation reuses this exact list
      // instead of re-extracting: one extraction per lecture, and the deck can never cover a
      // different set of facts than the notes were written from. keptInNote carries the outline's
      // exam-worthiness judgment (with its mechanical bounds already applied), so the decks test
      // what the note teaches instead of re-deciding importance from the inflated rating alone.
      knowledgeItems: (() => {
        const keptIds = new Set(outline.topics.flatMap((topic) => topic.itemIds));

        return items.map(({ id, claim, kind, importance, terms, sectionTitle }) => ({
          claim,
          kind,
          importance,
          terms,
          sectionTitle,
          keptInNote: keptIds.has(id),
        }));
      })(),
      sourceType: params.sourceType,
      sourceWordCount,
      noteWordCount: normalizedNoteWordCount,
      coverageRatio:
        sourceWordCount > 0
          ? Number((normalizedNoteWordCount / sourceWordCount).toFixed(3))
          : null,
      extractedItemCount: items.length,
      retainedItemCount,
      droppedItemCount: outline.droppedItemIds.length,
      topicCount: outline.topics.length,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Legacy pipeline (rollback switch)                                          */
/* -------------------------------------------------------------------------- */

async function generateNotesLegacy(
  segments: TranscriptSegmentInput[],
  params: {
    sourceLabel: string;
    pipelineName: string;
    sourceType: "audio" | "document";
    outputLanguage?: string | null;
    sourceTitleHint?: string | null;
  },
): Promise<NoteGenerationResult> {
  const sourceType = params.sourceType;
  const windows = buildTranscriptWindows(segments, sourceType === "audio" ? 2200 : 3200);
  const sourceWordCount = segments.reduce((total, segment) => total + countWords(segment.text), 0);
  const targets =
    sourceType === "audio"
      ? buildLegacyAudioNoteTargets(sourceWordCount, windows.length)
      : buildLegacyNoteTargets(sourceWordCount, windows.length);
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);
  const labelLanguage = resolveNoteLabelLanguage(
    segments.map((segment) => segment.text).join("\n\n"),
    params.outputLanguage,
  );
  const chunkInstructions =
    sourceType === "audio"
      ? `${languageInstruction} You create source cards from spoken lecture transcript chunks. Identify the study-worthy material in this chunk: definitions, mechanisms, sequences, comparisons, formulas, examples, clarifications, caveats, and exam-relevant details. Preserve technical terms and explain abbreviated or implied ideas when the transcript supports them. Skip filler, repeated phrases, low-value asides, and examples that add no new understanding. Never invent facts. Bullet points must be complete study points, not fragments. ${MATH_FORMATTING_INSTRUCTIONS}`
      : `${languageInstruction} You create source cards from lecture-style source material. Identify the study-worthy material in this chunk: definitions, mechanisms, sequences, comparisons, formulas, caveats, examples already present in the source, and exam-relevant details. Skip filler, repeated wording, low-value details, and examples that add no new understanding. Never invent facts. Bullet points must be complete study points, not fragments. ${MATH_FORMATTING_INSTRUCTIONS}`;
  const structuredPlusInstructions = buildLegacyStructuredPlusInstructions({
    outputLanguage: labelLanguage,
    recommendedTopicCount: targets.recommendedTopicCount,
  });
  const finalInstructions = `${languageInstruction} You are preparing final study notes from ${params.sourceLabel}. Produce a title, summary, key topics, and student-ready notes that cover the important material in the source without unnecessary text. Work section by section through the material: decide what the learner needs to know, explain it clearly, and skip filler or repetition. Every chunk summary should contribute only its non-duplicate substantive content to the final notes. Build about ${targets.recommendedTopicCount} substantial sections when the material supports it. ${structuredPlusInstructions}`;

  const chunkOutputs = await mapWithConcurrency(
    windows,
    NOTE_CHUNK_SUMMARY_CONCURRENCY,
    (window, index) =>
      generateStructuredObject({
        schema: chunkSummarySchema,
        maxOutputTokens: sourceType === "audio" ? 1900 : 1400,
        instructions: chunkInstructions,
        input: `Source chunk ${index + 1} of ${windows.length}.\nTime range: ${window.startMs}-${window.endMs} ms.\nText:\n${window.text}`,
      }),
  );

  const result = await generateStructuredObject({
    schema: noteArtifactSchema,
    maxOutputTokens:
      sourceType === "audio"
        ? Math.min(12000, Math.max(7000, Math.round(targets.maxNoteWordCount * 2.4)))
        : Math.min(7000, Math.max(5200, Math.round(targets.maxNoteWordCount * 2.8))),
    instructions: finalInstructions,
    input: JSON.stringify(
      {
        sourceType,
        sourceWordCount,
        chunkCount: chunkOutputs.length,
        targets,
        sourceTitleHint: params.sourceTitleHint ?? null,
        chunkSummaries: chunkOutputs,
      },
      null,
      2,
    ),
  });

  const normalizedStructuredNotesMd = normalizeNoteCalloutLanguage(await repairWrittenNote({
    text: normalizeGeneratedNoteMarkdown(result.structuredNotesMd), language: labelLanguage,
  }), labelLanguage);
  const normalizedNoteWordCount = countWords(normalizedStructuredNotesMd);

  return {
    ...result,
    structuredNotesMd: normalizedStructuredNotesMd,
    modelMetadata: {
      chunkCount: chunkOutputs.length,
      sourceWordCount,
      noteWordCount: normalizedNoteWordCount,
      coverageRatio:
        sourceWordCount > 0
          ? Number((normalizedNoteWordCount / sourceWordCount).toFixed(3))
          : null,
      targetNoteWordCount: targets.targetNoteWordCount,
      recommendedTopicCount: targets.recommendedTopicCount,
      sourceType,
      pipeline: params.pipelineName,
      notesMode: "legacy",
    },
  };
}

export async function generateNotesFromTranscript(
  segments: TranscriptSegmentInput[],
  params: {
    sourceLabel: string;
    pipelineName: string;
    sourceType?: "audio" | "document";
    outputLanguage?: string | null;
    sourceTitleHint?: string | null;
    stopAfter?: NotesGenerationPhase;
    usageContext?: { userId?: string | null; lectureId?: string | null };
  },
): Promise<NoteGenerationResult | null> {
  const sourceType = params.sourceType ?? "audio";
  if (params.stopAfter && resolveNotesPipelineMode() === "legacy") return null;
  const sourceLanguage = await resolveSourceLanguage({
    text: segments.map((segment) => segment.text).join("\n\n"),
    hint: params.outputLanguage,
    ...params.usageContext,
  });
  const localized = { ...params, sourceType, outputLanguage: sourceLanguage };
  const generated = resolveNotesPipelineMode() === "legacy"
    ? await generateNotesLegacy(segments, localized)
    : await generateNotesContentDriven(segments, localized);
  if (generated) {
    generated.modelMetadata = { ...generated.modelMetadata, sourceLanguage: {
      version: 1, code: sourceLanguage, notesHash: generationCacheKey([generated.structuredNotesMd]),
    } };
  }
  return generated;
}
