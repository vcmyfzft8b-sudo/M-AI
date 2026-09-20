import "server-only";

import { z } from "zod";

import { isWorkAbortedError } from "@/lib/abort-context";
import { truncateForDatabase } from "@/lib/database-text";
import { generateStructuredObject } from "@/lib/ai/json";
import {
  countWords,
  MAX_ITEMS_PER_EXTRACTION_WINDOW,
  resolveExtractionMaxOutputTokens,
} from "@/lib/notes/note-prompts";
import {
  buildKnowledgeExtractionInstructions,
  collapseDuplicateItems,
  dedupeKnowledgeItems,
  DUPLICATE_JUDGE_INSTRUCTIONS,
  duplicateVerdictSchema,
  KNOWLEDGE_EXTRACTION_PASS_WINDOWS,
  knowledgeExtractionSchema,
  type IndexedKnowledgeItem,
} from "@/lib/notes/note-prompts";
import {
  buildUnitExtractionWindows,
  cardKindForItem,
  itemConceptKey,
  filterToNoteKeptItems,
  resolvePrimaryUnitIdx,
  selectDeckWorthyItems,
  synthesizeItemPlans,
  type UnitKnowledgeItem,
} from "@/lib/notes/study-item-mapping";
import {
  dedupeCardDraftsByContent,
  dedupePracticeDraftsByContent,
  dedupeQuizDraftsByContent,
} from "@/lib/notes/study-dedupe";
import {
  generationCacheKey,
  loadGenerationCacheEntries,
  saveGenerationCacheEntry,
  stageModelCacheKeyPart,
  withGenerationCheckpoint,
} from "@/lib/notes/generation-cache";
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
import { isGradableAnswerGuide } from "@/lib/practice-test-scoring";
import { areHighQualityQuizOptions, isHighQualityStudyPrompt } from "@/lib/study-quality";
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

/**
 * Cache stages for the per-batch study checkpoints, one per asset type so the three generators —
 * which can run concurrently for the same lecture — never clear each other's in-flight work.
 * The publish point of each asset type clears its own stage on success.
 */
export const STUDY_BATCH_CACHE_STAGES = {
  cards: "study_batch_cards",
  quiz: "study_batch_quiz",
  practice: "study_batch_practice",
} as const;

const STUDY_ITEM_EXTRACTION_CONCURRENCY = 6;
// Raised 3 -> 6 with the 2026-08-28 GLM switch: the model is ~3x slower per call, batches are
// independent, and each study step still has to fit its 300s invocation. Six concurrent small
// calls is what the extraction stage has always run without trouble.
const STUDY_ITEM_GENERATION_CONCURRENCY = 6;

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

const DUPLICATE_JUDGE_MAX_ITEMS = 300;
/**
 * Bounds judge spend and wall-clock on a pathological item flood: batches beyond this pass
 * through mechanically deduped only. Six full batches (1,800 items) is far past any healthy
 * lecture, and the cap is what keeps a user-facing path that reaches this (the practice-test
 * attempt route) from stacking a dozen serialized model calls in front of the learner.
 */
const DUPLICATE_JUDGE_MAX_BATCHES = 6;

async function judgeCollapseDuplicateItemBatch<TItem extends IndexedKnowledgeItem>(
  items: TItem[],
  usageContext: StudyUsageContext | undefined,
): Promise<TItem[]> {
  // A single item cannot duplicate itself; a call would be pure spend.
  if (items.length < 2) {
    return items;
  }

  // Safe truncation here too: this one is bound for a prompt rather than a
  // column, and a lone surrogate cannot be UTF-8 encoded onto the wire either.
  const input = items.map((item, index) => `${index}. ${truncateForDatabase(item.claim, 130)}`).join("\n");
  // Checkpointed so a retried generation reaches the same verdicts: the outline checkpoint is
  // keyed by the item list this judge produces, and a fresh (nondeterministic) judgment on every
  // attempt would quietly invalidate it.
  const cacheKey = generationCacheKey([
    stageModelCacheKeyPart("note_extract"),
    DUPLICATE_JUDGE_INSTRUCTIONS,
    input,
  ]);
  let result: { verdicts: z.infer<typeof duplicateVerdictSchema>["verdicts"] };

  try {
    result = await withGenerationCheckpoint({
      lectureId: usageContext?.lectureId,
      stage: "item_dedupe",
      cacheKey,
      schema: duplicateVerdictSchema,
      generate: () =>
        generateStructuredObject({
          schema: duplicateVerdictSchema,
          maxOutputTokens: Math.min(16_000, items.length * 16 + 600),
          stage: "note_extract",
          instructions: DUPLICATE_JUDGE_INSTRUCTIONS,
          input,
          usageContext: { ...(usageContext ?? {}), stage: "item_dedupe" },
        }),
    });
  } catch (error) {
    // A budget abort is not a judge failure to degrade around — the run is being cancelled.
    if (isWorkAbortedError(error)) {
      throw error;
    }

    // Degrade to "no duplicates found", and checkpoint that verdict too: a deck with some
    // duplicates beats a failed generation, and the retry must reproduce this exact item list
    // or the outline checkpoint keyed on it silently misses.
    result = { verdicts: [] };

    if (usageContext?.lectureId) {
      await saveGenerationCacheEntry({
        lectureId: usageContext.lectureId,
        stage: "item_dedupe",
        cacheKey,
        payload: result,
      });
    }
  }

  // Judge indices refer to list positions; collapse works on positional ids.
  const positional = items.map((item, index) => ({ ...item, id: index }));
  const survivors = collapseDuplicateItems(positional, result.verdicts);
  const importanceById = new Map(survivors.map((survivor) => [survivor.id, survivor.importance]));

  return items.flatMap((item, index) =>
    importanceById.has(index)
      ? [{ ...item, importance: importanceById.get(index) ?? item.importance }]
      : [],
  );
}

/**
 * One cheap judge call per batch collapses concept duplicates the mechanical merge cannot see —
 * cross-spelling and cross-angle restatements of one fact.
 *
 * Batched rather than capped at 300: the old early-out skipped the judge entirely above 300
 * items, which is precisely the lecture that needs deduping most — on 2026-08-25 the skipped
 * judge left thousands of near duplicates flowing into a ~150k-token outline prompt. A duplicate
 * pair split across two batches survives, which is still strictly better than judging nothing.
 */
export async function judgeCollapseDuplicateItems<TItem extends IndexedKnowledgeItem>(
  items: TItem[],
  usageContext?: StudyUsageContext,
): Promise<TItem[]> {
  if (items.length < 2) {
    return items;
  }

  const batches = chunkStudyItems(items, DUPLICATE_JUDGE_MAX_ITEMS);
  const judged = batches.slice(0, DUPLICATE_JUDGE_MAX_BATCHES);
  const passthrough = batches.slice(DUPLICATE_JUDGE_MAX_BATCHES);

  const results = await mapWithConcurrency(judged, 2, (batch) =>
    judgeCollapseDuplicateItemBatch(batch, usageContext),
  );

  return [...results.flat(), ...passthrough.flat()];
}

const storedKnowledgeItemSchema = {
  isValid(value: unknown): value is Omit<IndexedKnowledgeItem, "id"> {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const item = value as Record<string, unknown>;

    return (
      typeof item.claim === "string" &&
      item.claim.length >= 12 &&
      typeof item.kind === "string" &&
      typeof item.importance === "number" &&
      typeof item.sectionTitle === "string" &&
      Array.isArray(item.terms)
    );
  },
};

/**
 * Reads the knowledge items the note pipeline stored on the artifact, mapped onto source units by
 * vocabulary overlap. Returns null when the artifact predates item storage (legacy notes) — the
 * caller then falls back to a fresh extraction.
 *
 * Reuse is the point, not just a saving: when the deck extracts its own items it can cover a
 * different set of facts than the notes teach, which is precisely the divergence the shared item
 * list exists to prevent.
 */
export async function resolveStoredStudyItems(params: {
  artifactModelMetadata: unknown;
  units: SourceUnit[];
  usageContext?: StudyUsageContext;
}): Promise<UnitKnowledgeItem[] | null> {
  const metadata = params.artifactModelMetadata;

  if (typeof metadata !== "object" || metadata === null) {
    return null;
  }

  const rawItems = (metadata as Record<string, unknown>).knowledgeItems;

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return null;
  }

  const validItems = rawItems.filter(storedKnowledgeItemSchema.isValid);

  const items = filterToNoteKeptItems(
    validItems as Array<(typeof validItems)[number] & { keptInNote?: unknown }>,
  );

  if (items.length === 0) {
    return null;
  }

  const unitByIndex = new Map(params.units.map((unit) => [unit.unitIndex, unit]));
  const allUnitIndexes = params.units.map((unit) => unit.unitIndex);

  // Items stored by an earlier pipeline version may predate the duplicate merges, and a deck
  // generated from them re-inherits every near-duplicate. Deduping on load — mechanically and
  // through the judge — makes reuse safe regardless of which version wrote the artifact.
  const deduped = await judgeCollapseDuplicateItems(
    dedupeKnowledgeItems(
      items.map((item, id) => ({
        ...item,
        id,
        importance: Math.max(1, Math.min(5, Math.round(item.importance))),
      })),
    ),
    params.usageContext,
  );

  return deduped.map((item, id) => ({
    ...item,
    id,
    coveredUnitIndexes: allUnitIndexes,
    primaryUnitIdx: resolvePrimaryUnitIdx(item.claim, allUnitIndexes, unitByIndex),
  }));
}

export async function extractStudyItems(params: {
  units: SourceUnit[];
  sourceType: "audio" | "document";
  outputLanguage?: string | null;
  usageContext?: StudyUsageContext;
  /** The note artifact's model_metadata; stored items there are reused instead of re-extracting. */
  artifactModelMetadata?: unknown;
}): Promise<UnitKnowledgeItem[]> {
  if (params.artifactModelMetadata != null) {
    const stored = await resolveStoredStudyItems({
      artifactModelMetadata: params.artifactModelMetadata,
      units: params.units,
      usageContext: params.usageContext,
    });

    if (stored) {
      return selectDeckWorthyItems(stored);
    }
  }

  const windows = buildUnitExtractionWindows(params.units, KNOWLEDGE_EXTRACTION_PASS_WINDOWS);
  const unitByIndex = new Map(params.units.map((unit) => [unit.unitIndex, unit]));
  const instructions = buildKnowledgeExtractionInstructions({
    outputLanguage: params.outputLanguage,
    sourceType: params.sourceType,
  });

  // Same checkpointing as the note pipeline's extraction: a budget-killed run resumes on retry
  // instead of re-buying every window. This path's windows come from a different builder than
  // the note pipeline's, so it gets its own cache namespace and its own usage stage — the deck
  // pipelines must neither pollute the note pipeline's generation guard counters nor force the
  // note run to page through their rows.
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
        stage: "study_extract",
        cacheKeys: windowPlans.map((plan) => plan.cacheKey),
      })
    : new Map<string, unknown>();

  const extractions = await mapWithConcurrency(
    windowPlans,
    STUDY_ITEM_EXTRACTION_CONCURRENCY,
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
            usageContext: { ...(params.usageContext ?? {}), stage: "study_extract" },
          });

      if (!cached.success && lectureId) {
        await saveGenerationCacheEntry({
          lectureId,
          stage: "study_extract",
          cacheKey,
          payload: extraction,
        });
      }

      return {
        passIndex: window.passIndex,
        coveredUnitIndexes: window.coveredUnitIndexes,
        sectionTitle: extraction.sectionTitle,
        items: extraction.items.slice(0, MAX_ITEMS_PER_EXTRACTION_WINDOW),
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

  const judged = await judgeCollapseDuplicateItems(
    merged.map((item, id) => ({ ...item, id })),
    params.usageContext,
  );

  // Filtered here rather than at each deck builder: flashcards, quiz and practice all come
  // through this function, so one rule keeps the three decks on the same items — and the items
  // that never make the cut are never sent to a generation call.
  return selectDeckWorthyItems(
    judged.map((item, id) => ({
      ...item,
      id,
      primaryUnitIdx: resolvePrimaryUnitIdx(item.claim, item.coveredUnitIndexes, unitByIndex),
    })),
  );
}

function buildQuoteFromUnit(unit: SourceUnit | undefined, claim: string) {
  const source = unit?.text ?? claim;
  const normalized = source.replace(/\s+/g, " ").trim();

  return truncateForDatabase(normalized, 180);
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

const studyBatchCheckpointSchema = z.object({
  drafts: z.array(z.unknown()),
  coveredItemIds: z.array(z.number().int()),
});

/**
 * Runs one generator over the item batches, retries the union of skipped and missing items once,
 * and reports what stayed uncovered. One retry, not a loop: an item the generator refuses twice
 * is an item the prompts consider untestable, and looping on it just re-buys the same refusal.
 *
 * Each batch is checkpointed (note_generation_cache) when the caller names a checkpoint stage.
 * The note pipeline earned this the hard way (the 2026-08-25 cost spike) and the study
 * generators inherited the same exposure with the 2026-08-28 GLM switch: a large lecture's deck
 * is ~50 batches per asset type at ~20-30s each, which can outlive the 300s invocation — and a
 * retry with no checkpoints re-buys every batch and may never converge. Keys carry the resolved
 * model, the instructions and the batch's items, so a prompt or model change invalidates itself;
 * the caller clears its stage after a successful publish so a learner's regenerate stays fresh.
 */
async function generateWithSkipRetry<TDraft>(params: {
  items: UnitKnowledgeItem[];
  generateBatch: (batch: UnitKnowledgeItem[]) => Promise<{ drafts: TDraft[]; coveredItemIds: number[] }>;
  checkpoint?: { lectureId: string | null | undefined; stage: string; instructions: string };
}) {
  const runBatch = (batch: UnitKnowledgeItem[]) => {
    const checkpoint = params.checkpoint;

    if (!checkpoint?.lectureId) {
      return params.generateBatch(batch);
    }

    return withGenerationCheckpoint({
      lectureId: checkpoint.lectureId,
      stage: checkpoint.stage,
      cacheKey: generationCacheKey([
        stageModelCacheKeyPart("study_items"),
        checkpoint.instructions,
        JSON.stringify(batch.map((item) => [item.id, item.claim])),
      ]),
      schema: studyBatchCheckpointSchema,
      generate: () => params.generateBatch(batch),
    }) as Promise<{ drafts: TDraft[]; coveredItemIds: number[] }>;
  };
  const batches = chunkStudyItems(params.items);
  const firstRound = await mapWithConcurrency(
    batches,
    STUDY_ITEM_GENERATION_CONCURRENCY,
    runBatch,
  );
  const drafts = firstRound.flatMap((round) => round.drafts);
  const covered = new Set(firstRound.flatMap((round) => round.coveredItemIds));
  const missing = params.items.filter((item) => !covered.has(item.id));

  if (missing.length > 0) {
    const retryBatches = chunkStudyItems(missing);
    const retryRound = await mapWithConcurrency(
      retryBatches,
      STUDY_ITEM_GENERATION_CONCURRENCY,
      runBatch,
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
    checkpoint: {
      lectureId: params.usageContext?.lectureId,
      stage: STUDY_BATCH_CACHE_STAGES.cards,
      instructions,
    },
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

  return { drafts: dedupeCardDraftsByContent(drafts), uncoveredItemIds };
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
    checkpoint: {
      lectureId: params.usageContext?.lectureId,
      stage: STUDY_BATCH_CACHE_STAGES.quiz,
      instructions,
    },
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

          /*
           * The same gate the practice-test drafts pass through below.
           *
           * It was missing here, so a quiz question that pointed at a figure the learner cannot
           * see went straight into the deck — this path is the default pipeline, and the gate in
           * quiz.ts only guards the legacy concept planner. Measured across five fixtures in
           * three languages it drops none of the 269 questions those runs produced, so it costs
           * nothing on material that is already good and catches the case that is not.
           */
          if (!isHighQualityStudyPrompt(question.question) || !areHighQualityQuizOptions(question.options)) {
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

  return { drafts: dedupeQuizDraftsByContent(drafts), uncoveredItemIds };
}

export type ItemPracticeQuestionDraft = {
  prompt: string;
  answerGuide: string;
  difficulty: FlashcardDifficulty;
  conceptKey: string;
  sourceUnitIdx: number;
  sourceLocator: string | null;
  /**
   * The knowledge item's own 1-5 rating, carried through to the bank so a test drawn from it can
   * put the material a learner is most likely to be examined on in front of them first.
   */
  importance: number;
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
    checkpoint: {
      lectureId: params.usageContext?.lectureId,
      stage: STUDY_BATCH_CACHE_STAGES.practice,
      instructions,
    },
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
      /*
       * A question that cannot stand on its own, or whose marking scheme cannot be marked
       * against, is dropped here rather than stored. Its item is left out of coveredItemIds too,
       * so the skip-retry round asks for it again instead of the bank quietly losing it — and so
       * the alternative to a bad question is another attempt at a good one, not a hole.
       */
      const kept = questions.flatMap<{ itemId: number; draft: ItemPracticeQuestionDraft }>(
        (question) => {
          const item = itemById.get(question.itemId);

          if (!item) {
            return [];
          }

          const prompt = question.question.replace(/\s+/g, " ").trim();
          const answerGuide = question.expectedPoints
            .map((point) => `- ${point.replace(/\s+/g, " ").trim()}`)
            .join("\n");

          if (!isHighQualityStudyPrompt(prompt) || !isGradableAnswerGuide(answerGuide)) {
            return [];
          }

          return [
            {
              itemId: question.itemId,
              draft: {
                prompt,
                answerGuide,
                difficulty: practiceDifficultyForItem(item),
                conceptKey: itemConceptKey(item),
                sourceUnitIdx: item.primaryUnitIdx,
                sourceLocator: unitByIndex.get(item.primaryUnitIdx)?.locatorLabel ?? null,
                importance: item.importance,
              },
            },
          ];
        },
      );

      return {
        drafts: kept.map((entry) => entry.draft),
        coveredItemIds: kept.map((entry) => entry.itemId),
      };
    },
  });

  return { drafts: dedupePracticeDraftsByContent(drafts), uncoveredItemIds };
}

export function buildItemPlans(items: UnitKnowledgeItem[], units: SourceUnit[]) {
  return synthesizeItemPlans(items, units);
}
