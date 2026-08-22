import "server-only";

import { generateStructuredObject } from "@/lib/ai/json";
import {
  buildKnowledgeExtractionInstructions,
  dedupeKnowledgeItems,
  KNOWLEDGE_EXTRACTION_PASS_WINDOWS,
  knowledgeExtractionSchema,
  type IndexedKnowledgeItem,
} from "@/lib/notes/note-prompts";
import {
  buildUnitExtractionWindows,
  cardKindForItem,
  itemConceptKey,
  resolvePrimaryUnitIdx,
  synthesizeItemPlans,
  type UnitKnowledgeItem,
} from "@/lib/notes/study-item-mapping";
import {
  buildFlashcardInstructions,
  buildPracticeTestInstructions,
  buildQuizInstructions,
  chunkStudyItems,
  flashcardBatchSchema,
  formatItemsForStudyGeneration,
  practiceBatchSchema,
  quizBatchSchema,
} from "@/lib/notes/study-prompts";
import type { CoverageCardDraft, CoverageUnitPlan, SourceUnit } from "@/lib/study-models";
import type { FlashcardDifficulty } from "@/lib/database.types";

/**
 * Item-driven study generation: the same knowledge items the notes are written from become the
 * coverage plan for flashcards, quiz and practice questions, so "did the deck cover it" and "did
 * the notes cover it" are one question. Measured against the legacy planner in
 * scripts/study-eval.mjs: fact recall 87-89% -> 97-100% with ~3x the material.
 *
 * "items" is the default; "legacy" restores the concept-planner path as a rollback switch.
 */
export function resolveStudyPipelineMode() {
  return process.env.STUDY_PIPELINE?.trim().toLowerCase() === "legacy" ? "legacy" : "items";
}

const STUDY_ITEM_EXTRACTION_CONCURRENCY = 3;
const STUDY_ITEM_GENERATION_CONCURRENCY = 3;

async function mapWithConcurrency<TInput, TOutput>(
  values: TInput[],
  concurrency: number,
  mapper: (value: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(values.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);

  return results;
}

type StudyUsageContext = { userId?: string | null; lectureId?: string | null };

export async function extractStudyItems(params: {
  units: SourceUnit[];
  sourceType: "audio" | "document";
  outputLanguage?: string | null;
  usageContext?: StudyUsageContext;
}): Promise<UnitKnowledgeItem[]> {
  const windows = buildUnitExtractionWindows(params.units, KNOWLEDGE_EXTRACTION_PASS_WINDOWS);
  const unitByIndex = new Map(params.units.map((unit) => [unit.unitIndex, unit]));
  const instructions = buildKnowledgeExtractionInstructions({
    outputLanguage: params.outputLanguage,
    sourceType: params.sourceType,
  });

  const extractions = await mapWithConcurrency(
    windows,
    STUDY_ITEM_EXTRACTION_CONCURRENCY,
    async (window) => {
      const extraction = await generateStructuredObject({
        schema: knowledgeExtractionSchema,
        maxOutputTokens: 1800,
        stage: "note_extract",
        instructions,
        input: `${window.label}.\n\n${window.text}`,
        usageContext: params.usageContext,
      });

      return {
        passIndex: window.passIndex,
        coveredUnitIndexes: window.coveredUnitIndexes,
        sectionTitle: extraction.sectionTitle,
        items: extraction.items,
      };
    },
  );

  const byPass = new Map<number, Array<IndexedKnowledgeItem & { coveredUnitIndexes: number[] }>>();

  for (const extraction of extractions) {
    const items = extraction.items.map((item, id) => ({
      ...item,
      id,
      sectionTitle: extraction.sectionTitle,
      coveredUnitIndexes: extraction.coveredUnitIndexes,
    }));
    byPass.set(extraction.passIndex, [...(byPass.get(extraction.passIndex) ?? []), ...items]);
  }

  // Dedupe within each pass with the repeat boost (a repeat there is emphasis), then across
  // passes without it (there, every claim is expected twice). dedupeKnowledgeItems preserves the
  // surviving item's own fields, so coveredUnitIndexes rides along.
  const perPass = [...byPass.values()].flatMap((items) =>
    dedupeKnowledgeItems(
      items.map((item, id) => ({ ...item, id })),
      { boostRepeats: true },
    ),
  );
  const merged = dedupeKnowledgeItems(perPass.map((item, id) => ({ ...item, id })));

  return merged.map((item, id) => ({
    ...item,
    id,
    primaryUnitIdx: resolvePrimaryUnitIdx(item.claim, item.coveredUnitIndexes, unitByIndex),
  }));
}

function buildQuoteFromUnit(unit: SourceUnit | undefined, claim: string) {
  const source = unit?.text ?? claim;
  const normalized = source.replace(/\s+/g, " ").trim();

  return normalized.slice(0, 180);
}

function buildItemCitation(item: UnitKnowledgeItem, unitByIndex: Map<number, SourceUnit>) {
  const unit = unitByIndex.get(item.primaryUnitIdx);

  return {
    idx: item.primaryUnitIdx,
    startMs: unit?.startMs ?? 0,
    endMs: unit?.endMs ?? 0,
    quote: buildQuoteFromUnit(unit, item.claim),
  };
}

export type ItemStudyGenerationResult = {
  items: UnitKnowledgeItem[];
  plans: CoverageUnitPlan[];
};

/**
 * Runs one generator over the item batches, retries the union of skipped and missing items once,
 * and reports what stayed uncovered. One retry, not a loop: an item the generator refuses twice
 * is an item the prompts consider untestable, and looping on it just re-buys the same refusal.
 */
async function generateWithSkipRetry<TDraft>(params: {
  items: UnitKnowledgeItem[];
  generateBatch: (batch: UnitKnowledgeItem[]) => Promise<{ drafts: TDraft[]; coveredItemIds: number[] }>;
}) {
  const batches = chunkStudyItems(params.items);
  const firstRound = await mapWithConcurrency(
    batches,
    STUDY_ITEM_GENERATION_CONCURRENCY,
    params.generateBatch,
  );
  const drafts = firstRound.flatMap((round) => round.drafts);
  const covered = new Set(firstRound.flatMap((round) => round.coveredItemIds));
  const missing = params.items.filter((item) => !covered.has(item.id));

  if (missing.length > 0) {
    const retryBatches = chunkStudyItems(missing);
    const retryRound = await mapWithConcurrency(
      retryBatches,
      STUDY_ITEM_GENERATION_CONCURRENCY,
      params.generateBatch,
    );

    drafts.push(...retryRound.flatMap((round) => round.drafts));

    for (const round of retryRound) {
      for (const id of round.coveredItemIds) {
        covered.add(id);
      }
    }
  }

  return {
    drafts,
    uncoveredItemIds: params.items
      .filter((item) => !covered.has(item.id))
      .map((item) => item.id),
  };
}

export async function generateItemCardDrafts(params: {
  items: UnitKnowledgeItem[];
  units: SourceUnit[];
  outputLanguage?: string | null;
  usageContext?: StudyUsageContext;
}) {
  const unitByIndex = new Map(params.units.map((unit) => [unit.unitIndex, unit]));
  const itemById = new Map(params.items.map((item) => [item.id, item]));
  const instructions = buildFlashcardInstructions({ outputLanguage: params.outputLanguage });

  const { drafts, uncoveredItemIds } = await generateWithSkipRetry({
    items: params.items,
    generateBatch: async (batch) => {
      const result = await generateStructuredObject({
        schema: flashcardBatchSchema,
        maxOutputTokens: Math.max(1600, batch.length * 260),
        stage: "study_items",
        instructions,
        input: JSON.stringify({ items: formatItemsForStudyGeneration(batch) }, null, 2),
        usageContext: params.usageContext,
      });
      const requested = new Set(batch.map((item) => item.id));
      const cards = result.flashcards.filter((card) => requested.has(card.itemId));

      return {
        drafts: cards.flatMap<CoverageCardDraft>((card) => {
          const item = itemById.get(card.itemId);

          if (!item) {
            return [];
          }

          const unit = unitByIndex.get(item.primaryUnitIdx);

          return [
            {
              front: card.front,
              back: card.back,
              hint: null,
              difficulty: card.difficulty,
              citations: [buildItemCitation(item, unitByIndex)],
              conceptKey: itemConceptKey(item),
              cardKind: cardKindForItem(item),
              sourceUnitIdx: item.primaryUnitIdx,
              sourceType: unit?.sourceType ?? "audio",
              sourceLocator: unit?.locatorLabel ?? null,
              coverageRank: item.importance * 2,
            },
          ];
        }),
        coveredItemIds: cards.map((card) => card.itemId),
      };
    },
  });

  return { drafts, uncoveredItemIds };
}

export type ItemQuizQuestionDraft = {
  prompt: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  difficulty: FlashcardDifficulty;
  conceptKey: string;
  sourceUnitIdx: number;
  sourceLocator: string | null;
};

export async function generateItemQuizDrafts(params: {
  items: UnitKnowledgeItem[];
  units: SourceUnit[];
  outputLanguage?: string | null;
  usageContext?: StudyUsageContext;
}) {
  const unitByIndex = new Map(params.units.map((unit) => [unit.unitIndex, unit]));
  const itemById = new Map(params.items.map((item) => [item.id, item]));
  const instructions = buildQuizInstructions({ outputLanguage: params.outputLanguage });

  const { drafts, uncoveredItemIds } = await generateWithSkipRetry({
    items: params.items,
    generateBatch: async (batch) => {
      const result = await generateStructuredObject({
        schema: quizBatchSchema,
        maxOutputTokens: Math.max(2000, batch.length * 420),
        stage: "study_items",
        instructions,
        input: JSON.stringify({ items: formatItemsForStudyGeneration(batch) }, null, 2),
        usageContext: params.usageContext,
      });
      const requested = new Set(batch.map((item) => item.id));
      const questions = result.questions.filter((question) => requested.has(question.itemId));

      return {
        drafts: questions.flatMap<ItemQuizQuestionDraft>((question) => {
          const item = itemById.get(question.itemId);

          if (!item) {
            return [];
          }

          return [
            {
              prompt: question.question,
              options: question.options,
              correctOptionIndex: question.correctIndex,
              explanation: question.explanation,
              difficulty: question.difficulty,
              conceptKey: itemConceptKey(item),
              sourceUnitIdx: item.primaryUnitIdx,
              sourceLocator: unitByIndex.get(item.primaryUnitIdx)?.locatorLabel ?? null,
            },
          ];
        }),
        coveredItemIds: questions.map((question) => question.itemId),
      };
    },
  });

  return { drafts, uncoveredItemIds };
}

export type ItemPracticeQuestionDraft = {
  prompt: string;
  answerGuide: string;
  difficulty: FlashcardDifficulty;
  conceptKey: string;
  sourceUnitIdx: number;
  sourceLocator: string | null;
};

function practiceDifficultyForItem(item: UnitKnowledgeItem): FlashcardDifficulty {
  if (item.kind === "definition" || item.kind === "fact" || item.kind === "formula") {
    return "easy";
  }

  return item.kind === "caveat" ? "hard" : "medium";
}

export async function generateItemPracticeDrafts(params: {
  items: UnitKnowledgeItem[];
  units: SourceUnit[];
  outputLanguage?: string | null;
  usageContext?: StudyUsageContext;
}) {
  const unitByIndex = new Map(params.units.map((unit) => [unit.unitIndex, unit]));
  const itemById = new Map(params.items.map((item) => [item.id, item]));
  const instructions = buildPracticeTestInstructions({ outputLanguage: params.outputLanguage });

  const { drafts, uncoveredItemIds } = await generateWithSkipRetry({
    items: params.items,
    generateBatch: async (batch) => {
      const result = await generateStructuredObject({
        schema: practiceBatchSchema,
        maxOutputTokens: Math.max(1800, batch.length * 380),
        stage: "study_items",
        instructions,
        input: JSON.stringify({ items: formatItemsForStudyGeneration(batch) }, null, 2),
        usageContext: params.usageContext,
      });
      const requested = new Set(batch.map((item) => item.id));
      const questions = result.questions.filter((question) => requested.has(question.itemId));

      return {
        drafts: questions.flatMap<ItemPracticeQuestionDraft>((question) => {
          const item = itemById.get(question.itemId);

          if (!item) {
            return [];
          }

          return [
            {
              prompt: question.question,
              answerGuide: question.expectedPoints.map((point) => `- ${point}`).join("\n"),
              difficulty: practiceDifficultyForItem(item),
              conceptKey: itemConceptKey(item),
              sourceUnitIdx: item.primaryUnitIdx,
              sourceLocator: unitByIndex.get(item.primaryUnitIdx)?.locatorLabel ?? null,
            },
          ];
        }),
        coveredItemIds: questions.map((question) => question.itemId),
      };
    },
  });

  return { drafts, uncoveredItemIds };
}

export function buildItemPlans(items: UnitKnowledgeItem[], units: SourceUnit[]) {
  return synthesizeItemPlans(items, units);
}
