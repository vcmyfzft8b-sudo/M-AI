import "server-only";

import { chunkSummarySchema, noteArtifactSchema } from "@/lib/ai/schemas";
import { generateStructuredObject } from "@/lib/ai/json";
import { buildTranscriptWindows } from "@/lib/chunking";
import {
  buildGeneratedContentLanguageInstruction,
  resolveNoteLanguageLabel,
} from "@/lib/languages";
import {
  buildKnowledgeExtractionInstructions,
  buildLegacyAudioNoteTargets,
  buildLegacyNoteTargets,
  buildLegacyStructuredPlusInstructions,
  buildNoteOutlineInstructions,
  buildNoteWritingInstructions,
  countWords,
  dedupeKnowledgeItems,
  formatOutlineForWriting,
  KNOWLEDGE_EXTRACTION_PASS_WINDOWS,
  MAX_ITEMS_PER_EXTRACTION_WINDOW,
  resolveExtractionMaxOutputTokens,
  knowledgeExtractionSchema,
  MATH_FORMATTING_INSTRUCTIONS,
  enforceOutlineRetentionBounds,
  noteOutlineSchema,
  noteWriteSchema,
  normalizeGeneratedNoteMarkdown,
  splitTextForExtraction,
  type IndexedKnowledgeItem,
} from "@/lib/notes/note-prompts";
import { judgeCollapseDuplicateItems } from "@/lib/study-items";
import type { NoteGenerationResult, TranscriptSegmentInput } from "@/lib/types";

const NOTE_CHUNK_SUMMARY_CONCURRENCY = 2;
const NOTE_EXTRACTION_CONCURRENCY = 3;

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

  const extractions = await mapWithConcurrency(
    windows,
    NOTE_EXTRACTION_CONCURRENCY,
    async (window) => {
      const extraction = await generateStructuredObject({
        schema: knowledgeExtractionSchema,
        maxOutputTokens: resolveExtractionMaxOutputTokens(countWords(window.text)),
        stage: "note_extract",
        instructions,
        input: `${window.label}.\n\n${window.text}`,
        usageContext: params.usageContext,
      });

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

async function generateNotesContentDriven(
  segments: TranscriptSegmentInput[],
  params: {
    sourceLabel: string;
    pipelineName: string;
    sourceType: "audio" | "document";
    outputLanguage?: string | null;
    sourceTitleHint?: string | null;
    usageContext?: { userId?: string | null; lectureId?: string | null };
  },
): Promise<NoteGenerationResult> {
  const sourceWordCount = segments.reduce((total, segment) => total + countWords(segment.text), 0);
  const items = await extractKnowledgeItems({
    segments,
    sourceType: params.sourceType,
    outputLanguage: params.outputLanguage,
    usageContext: params.usageContext,
  });

  if (items.length === 0) {
    throw new Error("Knowledge extraction found no study-worthy content in the source.");
  }

  const rawOutline = await generateStructuredObject({
    schema: noteOutlineSchema,
    maxOutputTokens: Math.max(2600, items.length * 60),
    stage: "note_outline",
    instructions: buildNoteOutlineInstructions({ outputLanguage: params.outputLanguage }),
    input: JSON.stringify(
      {
        sourceType: params.sourceType,
        sourceLabel: params.sourceLabel,
        sourceTitleHint: params.sourceTitleHint ?? null,
        items: items.map(({ id, claim, kind, importance, sectionTitle }) => ({
          id,
          claim,
          kind,
          importance,
          sectionTitle,
        })),
      },
      null,
      2,
    ),
    usageContext: params.usageContext,
  });

  // The model chooses; the bounds on that choice are mechanical. See the function's own comment.
  const outline = enforceOutlineRetentionBounds(rawOutline, items);
  const retainedItemCount = outline.topics.reduce(
    (total, topic) => total + topic.itemIds.length,
    0,
  );
  const sourceText = segments.map((segment) => segment.text).join("\n\n");

  // Budgeted from the retained items rather than from a word target: length follows the content,
  // and so does the budget for writing it.
  const written = await generateStructuredObject({
    schema: noteWriteSchema,
    maxOutputTokens: Math.max(4000, retainedItemCount * 170),
    stage: "note_write",
    instructions: buildNoteWritingInstructions({
      outputLanguage: params.outputLanguage,
      coverageObjective: true,
      pedagogy: true,
    }),
    input: `Outline to teach:\n${JSON.stringify(
      {
        title: outline.title,
        summary: outline.summary,
        topics: formatOutlineForWriting({ outline, items }),
      },
      null,
      2,
    )}\n\nFull source text:\n${sourceText}`,
    usageContext: params.usageContext,
  });

  const normalizedStructuredNotesMd = normalizeGeneratedNoteMarkdown(written.structuredNotesMd);
  const normalizedNoteWordCount = countWords(normalizedStructuredNotesMd);

  return {
    title: outline.title,
    summary: outline.summary,
    keyTopics: outline.keyTopics,
    structuredNotesMd: normalizedStructuredNotesMd,
    modelMetadata: {
      pipeline: params.pipelineName,
      notesMode: "content",
      // The extracted items travel with the artifact so study generation reuses this exact list
      // instead of re-extracting: one extraction per lecture, and the deck can never cover a
      // different set of facts than the notes were written from.
      knowledgeItems: items.map(({ claim, kind, importance, terms, sectionTitle }) => ({
        claim,
        kind,
        importance,
        terms,
        sectionTitle,
      })),
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
  const languageLabel = resolveNoteLanguageLabel(params.outputLanguage);
  const chunkInstructions =
    sourceType === "audio"
      ? `${languageInstruction} You create source cards from spoken lecture transcript chunks. Identify the study-worthy material in this chunk: definitions, mechanisms, sequences, comparisons, formulas, examples, clarifications, caveats, and exam-relevant details. Preserve technical terms and explain abbreviated or implied ideas when the transcript supports them. Skip filler, repeated phrases, low-value asides, and examples that add no new understanding. Never invent facts. Bullet points must be complete study points, not fragments. ${MATH_FORMATTING_INSTRUCTIONS}`
      : `${languageInstruction} You create source cards from lecture-style source material. Identify the study-worthy material in this chunk: definitions, mechanisms, sequences, comparisons, formulas, caveats, examples already present in the source, and exam-relevant details. Skip filler, repeated wording, low-value details, and examples that add no new understanding. Never invent facts. Bullet points must be complete study points, not fragments. ${MATH_FORMATTING_INSTRUCTIONS}`;
  const structuredPlusInstructions = buildLegacyStructuredPlusInstructions({
    outputLanguage: params.outputLanguage,
    recommendedTopicCount: targets.recommendedTopicCount,
  });
  const finalInstructions = `${languageInstruction} You are preparing final study notes in ${languageLabel} from ${params.sourceLabel}. Produce a title, summary, key topics, and student-ready notes that cover the important material in the source without unnecessary text. Work section by section through the material: decide what the learner needs to know, explain it clearly, and skip filler or repetition. Every chunk summary should contribute only its non-duplicate substantive content to the final notes. Build about ${targets.recommendedTopicCount} substantial sections when the material supports it. ${structuredPlusInstructions}`;

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

  const normalizedStructuredNotesMd = normalizeGeneratedNoteMarkdown(result.structuredNotesMd);
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
    usageContext?: { userId?: string | null; lectureId?: string | null };
  },
): Promise<NoteGenerationResult> {
  const sourceType = params.sourceType ?? "audio";

  if (resolveNotesPipelineMode() === "legacy") {
    return generateNotesLegacy(segments, { ...params, sourceType });
  }

  return generateNotesContentDriven(segments, { ...params, sourceType });
}
