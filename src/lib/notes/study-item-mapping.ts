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
