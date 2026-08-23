import type {
  CoverageCardKind,
  CoverageConceptType,
  CoverageUnitPlan,
  SourceImportance,
  SourceUnit,
} from "../study-models.ts";

import { splitTextForExtraction, type IndexedKnowledgeItem, type KnowledgeItem } from "./note-prompts.ts";

// Kept free of "server-only" so the item→unit mapping stays unit-testable
// (tests/study-item-mapping.test.mjs) outside the Next.js runtime.

/** A knowledge item tied back to the source units its extraction window covered. */
export type UnitKnowledgeItem = IndexedKnowledgeItem & {
  coveredUnitIndexes: number[];
  primaryUnitIdx: number;
};

export type UnitExtractionWindow = {
  passIndex: number;
  label: string;
  text: string;
  coveredUnitIndexes: number[];
};

/**
 * Groups consecutive source units into extraction windows of roughly the requested word size,
 * remembering which units each window covers so extracted claims can be cited back to a unit.
 * A unit larger than the window becomes its own window rather than being split, because a
 * citation must always land on a whole unit.
 */
export function buildUnitExtractionWindows(
  units: SourceUnit[],
  passWindowWords: readonly number[],
): UnitExtractionWindow[] {
  return passWindowWords.flatMap((windowWords, passIndex) => {
    const windows: Array<{ text: string[]; coveredUnitIndexes: number[]; words: number }> = [];
    let current: { text: string[]; coveredUnitIndexes: number[]; words: number } | null = null;

    for (const unit of units) {
      if (current && current.words + unit.wordCount > windowWords && current.words > 0) {
        windows.push(current);
        current = null;
      }

      current ??= { text: [], coveredUnitIndexes: [], words: 0 };
      current.text.push(unit.text);
      current.coveredUnitIndexes.push(unit.unitIndex);
      current.words += unit.wordCount;
    }

    if (current && current.words > 0) {
      windows.push(current);
    }

    // A single unit can itself exceed the window (whole-recording transcript segments become
    // one unit); split its text while keeping the unit attribution for citations.
    const maxChars = Math.round(windowWords * 6.5);

    return windows.flatMap((window, index) =>
      splitTextForExtraction(window.text.join("\n\n"), maxChars).map((text) => ({
        passIndex,
        label: `Chunk ${index + 1} of ${windows.length}`,
        text,
        coveredUnitIndexes: window.coveredUnitIndexes,
      })),
    );
  });
}

function claimTokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3),
  );
}

/**
 * Picks the covered unit whose text shares the most vocabulary with the claim, so the card's
 * citation points at the sentence the fact actually came from rather than the window's first unit.
 */
export function resolvePrimaryUnitIdx(
  claim: string,
  coveredUnitIndexes: number[],
  unitByIndex: Map<number, SourceUnit>,
): number {
  const tokens = claimTokens(claim);
  let bestIdx = coveredUnitIndexes[0] ?? 0;
  let bestOverlap = -1;

  for (const unitIndex of coveredUnitIndexes) {
    const unit = unitByIndex.get(unitIndex);

    if (!unit) {
      continue;
    }

    const unitTokens = claimTokens(unit.text);
    let overlap = 0;

    for (const token of tokens) {
      if (unitTokens.has(token)) {
        overlap += 1;
      }
    }

    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIdx = unitIndex;
    }
  }

  return bestIdx;
}

const CONCEPT_TYPE_BY_KIND: Record<KnowledgeItem["kind"], CoverageConceptType> = {
  definition: "definition",
  formula: "formula",
  mechanism: "process",
  comparison: "comparison",
  causal: "cause_effect",
  procedure: "sequence",
  fact: "term",
  caveat: "warning",
};

const CARD_KIND_BY_KIND: Record<KnowledgeItem["kind"], CoverageCardKind> = {
  definition: "recall",
  formula: "recall",
  mechanism: "explain",
  comparison: "compare",
  causal: "explain",
  procedure: "sequence",
  fact: "recall",
  caveat: "explain",
};

export function conceptTypeForItem(item: Pick<KnowledgeItem, "kind">) {
  return CONCEPT_TYPE_BY_KIND[item.kind];
}

export function cardKindForItem(item: Pick<KnowledgeItem, "kind">) {
  return CARD_KIND_BY_KIND[item.kind];
}

export function studyValueForImportance(importance: number): SourceImportance {
  if (importance >= 4) {
    return "high";
  }

  return importance >= 3 ? "medium" : "low";
}

export function itemConceptKey(item: Pick<UnitKnowledgeItem, "id">) {
  return `item-${item.id}`;
}

/**
 * Presents the knowledge items as the coverage plan the existing validation, budgeting and
 * publishing machinery consumes: one concept per item, one card per concept. The importance
 * rating maps onto qualityScore so downstream quality gates keep working (3 → the acceptance
 * floor of 6, 5 → 10). Nothing downstream needs to know the plan came from items.
 */
export function synthesizeItemPlans(
  items: UnitKnowledgeItem[],
  units: SourceUnit[],
): CoverageUnitPlan[] {
  const itemsByUnit = new Map<number, UnitKnowledgeItem[]>();

  for (const item of items) {
    itemsByUnit.set(item.primaryUnitIdx, [...(itemsByUnit.get(item.primaryUnitIdx) ?? []), item]);
  }

  return units.map((unit) => {
    const unitItems = itemsByUnit.get(unit.unitIndex) ?? [];
    const maxImportance = unitItems.reduce((max, item) => Math.max(max, item.importance), 0);

    return {
      unitIndex: unit.unitIndex,
      sectionIndex: unit.sectionIndex,
      sectionTitle: unit.sectionTitle,
      importance: studyValueForImportance(maxImportance),
      concepts: unitItems.map((item) => ({
        conceptKey: itemConceptKey(item),
        conceptLabel: item.claim.slice(0, 80),
        conceptType: conceptTypeForItem(item),
        studyValue: studyValueForImportance(item.importance),
        qualityScore: Math.max(0, Math.min(10, item.importance * 2)),
        recommendedCardCount: 1,
        preferredCardStyle: cardKindForItem(item),
        supportingExcerpt: item.claim.slice(0, 180),
      })),
    };
  });
}

/** A learner fails without a 5 and is likely tested on a 4; 3 and below are context, not a deck. */
export const DECK_IMPORTANCE_FLOOR = 4;
/** Below this a filtered deck stops being a study tool, so the next-best items are topped up. */
export const MIN_DECK_ITEMS = 12;
/** No lecture produces a deck a learner will not finish; a 43-slide source used to yield 134. */
export const MAX_DECK_ITEMS = 60;
/**
 * What the rest of a lecture is built on, and what an exam asks first. Measured on the same
 * 43-slide law deck (2026-08-23): filtering on the rating alone dropped "a thing is an independent
 * physical object", "everything permanently joined to immovable property is a component part" and
 * three more core definitions, because the extractor had rated them 3. The rating is not reliable
 * enough to overrule a definition, so it does not get to.
 */
const DECK_BACKBONE_KINDS = new Set(["definition", "formula"]);
/** Rated disposable by the extractor's own rubric — a 1 is not deck material whatever its kind. */
const DECK_MINIMUM_IMPORTANCE = 2;

/**
 * Picks the items a deck is built from. The notes still teach every extracted item — that is what
 * they are for — but a card, a quiz question and a practice question each cost a learner attention
 * and cost us a generation call, so only what a learner must know earns one.
 *
 * Two things qualify: the definitions and formulas the subject is built on, whatever they were
 * rated, and anything the extractor rated must-know. The rating is used as a floor and a ranking,
 * never as arithmetic — it inflates (measured: 53% of items at 4 or 5) and it misfires on basics,
 * so it decides the margin, not the backbone. Over the ceiling the surplus is dropped by spreading
 * the survivors across the source rather than taking a prefix, so a trimmed deck still reaches the
 * end of the lecture.
 */
export function selectDeckWorthyItems<T extends { importance: number; kind?: string }>(
  items: T[],
  options?: { floor?: number; minItems?: number; maxItems?: number },
): T[] {
  const floor = options?.floor ?? DECK_IMPORTANCE_FLOOR;
  const minItems = options?.minItems ?? MIN_DECK_ITEMS;
  const maxItems = options?.maxItems ?? MAX_DECK_ITEMS;
  const positionOf = new Map(items.map((item, position) => [item, position]));
  const inSourceOrder = (left: T, right: T) =>
    (positionOf.get(left) ?? 0) - (positionOf.get(right) ?? 0);
  const isBackbone = (item: T) =>
    item.kind !== undefined &&
    DECK_BACKBONE_KINDS.has(item.kind) &&
    item.importance >= DECK_MINIMUM_IMPORTANCE;

  const backbone = items.filter(isBackbone);
  const rated = items.filter((item) => !isBackbone(item) && item.importance >= floor);
  const kept = [...backbone, ...rated].sort(inSourceOrder);

  // A short or evenly-rated source can leave too few must-knows to study from. Top up with the
  // next best, highest rating first, keeping source order among equals.
  if (kept.length < minItems) {
    const chosen = new Set(kept);
    const toppedUp = items
      .filter((item) => !chosen.has(item) && item.importance >= DECK_MINIMUM_IMPORTANCE)
      .sort((left, right) => right.importance - left.importance || inSourceOrder(left, right))
      .slice(0, minItems - kept.length);

    return [...kept, ...toppedUp].sort(inSourceOrder);
  }

  if (kept.length <= maxItems) {
    return kept;
  }

  // Over the ceiling the rated margin gives way first; the backbone is only thinned if the
  // definitions alone would still overflow.
  const spread = (group: T[], budget: number) =>
    group.length <= budget
      ? group
      : Array.from(
          { length: budget },
          (_unused, slot) => group[Math.floor(slot * (group.length / budget))],
        );
  const keptBackbone = spread(backbone, maxItems);

  return [...keptBackbone, ...spread(rated, maxItems - keptBackbone.length)].sort(inSourceOrder);
}

/**
 * Deals the deck round-robin across its topics instead of walking the source front to back.
 *
 * Practising one topic to exhaustion before starting the next (blocked practice) feels easier and
 * teaches less: the learner never has to work out *which* idea a question is about, because the
 * block already told them. Interleaving forces that discrimination on every card, and is one of
 * the techniques the learning-science reviews rate as genuinely improving retention.
 *
 * Source order is kept inside each topic, so a sequence that has to be learned in order still is.
 */
export function interleaveByTopic<TCard extends { sourceUnitIdx: number }>(cards: TCard[]) {
  const byTopic = new Map<number, TCard[]>();

  for (const card of cards) {
    byTopic.set(card.sourceUnitIdx, [...(byTopic.get(card.sourceUnitIdx) ?? []), card]);
  }

  const queues = [...byTopic.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, group]) => group);
  const output: TCard[] = [];

  for (let round = 0; output.length < cards.length; round += 1) {
    for (const queue of queues) {
      if (round < queue.length) {
        output.push(queue[round]);
      }
    }
  }

  return output;
}
