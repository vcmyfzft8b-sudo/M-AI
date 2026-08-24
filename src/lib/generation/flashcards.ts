import "server-only";

import { z } from "zod";

import type { FlashcardDifficulty } from "@/lib/database.types";
import { buildLanguageDirective } from "@/lib/generation/language";
import { generateObject, type GenerationCallContext } from "@/lib/generation/llm";
import type { LearningPoint, StudySectionPlan } from "@/lib/generation/learning-points";
import { renderUnitsForModel, type SourceUnit } from "@/lib/generation/source";
import { mapWithConcurrency, normalizeComparisonKey, normalizeInline } from "@/lib/generation/util";

export const STUDY_PIPELINE_VERSION = "study-v3-learning-points";

const CARD_WRITE_CONCURRENCY = 4;
const MAX_POINTS_PER_CARD_BATCH = 12;
export const MAX_FLASHCARDS = 90;

export type FlashcardKind = "recall" | "explain" | "compare" | "apply" | "sequence";

export type FlashcardDraft = {
  front: string;
  back: string;
  hint: string | null;
  difficulty: FlashcardDifficulty;
  kind: FlashcardKind;
  point: LearningPoint;
};

const cardSchema = z.object({
  pointIndex: z.number().int().min(0),
  front: z.string().min(6).max(260),
  back: z.string().min(1).max(460),
  hint: z.string().min(2).max(200).nullable(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  kind: z.enum(["recall", "explain", "compare", "apply", "sequence"]),
});

const cardBatchSchema = z.object({
  cards: z.array(cardSchema).min(1).max(MAX_POINTS_PER_CARD_BATCH),
});

function buildCardInstructions(params: {
  notesTitle: string | null;
  languageCode?: string | null;
}) {
  return `You write flashcards for spaced repetition${
    params.notesTitle ? ` on the material "${params.notesTitle}"` : ""
  }. You get numbered learning points plus the source passages they came from. Write EXACTLY ONE card per learning point, tagged with its pointIndex.

${buildLanguageDirective(params.languageCode)}

CARD CRAFT — these rules decide whether the card actually teaches:
- front: a specific question or task that forces retrieval of the point. It must be answerable without the source open, and must have ONE correct answer. Never "What did the lecture say about X?" and never a bare term with no question.
- back: the shortest complete correct answer — aim under 30 words. Answer the front directly; do not restate the question; no hedging, no "it depends".
- Minimum information: test one fact. If the point lists several items, ask for the list as a set ("Naštej tri …") only when the set itself is the fact; otherwise ask for the most important item.
- Discrimination: when two points are easily confused, the front must name the contrast explicitly ("How does X differ from Y?") so the learner practises telling them apart, not guessing.
- hint: an optional nudge — category, mnemonic, first letter, or contrast — that helps a stuck learner WITHOUT revealing the answer. Use null for easy cards; a hint that gives the answer away is worse than none.
- difficulty: easy = direct recall of one fact · medium = requires understanding a relationship or mechanism · hard = requires applying or combining knowledge.
- kind: recall (fact/definition retrieval) · explain (mechanism, why/how) · compare (contrast two things) · apply (use knowledge on a case) · sequence (ordered steps).
- Plain text only: no markdown, no LaTeX. Write formulas in readable plain notation (e.g. "F = m·a", "x = (-b ± √(b²-4ac)) / 2a", superscripts as ², ³ where possible).
- Phrase fronts the way an exam would in the output language; keep technical terms as the field uses them.`;
}

function buildCardBatchInput(points: LearningPoint[]) {
  const unitsById = new Map<number, SourceUnit>();

  for (const point of points) {
    for (const unit of point.units) {
      unitsById.set(unit.unitId, unit);
    }
  }

  const pointListing = points
    .map(
      (point) =>
        `${point.index}. [${point.kind}, ${point.importance}] ${point.statement} (source: ${point.units
          .map((unit) => `U${unit.unitId}`)
          .join(", ")})`,
    )
    .join("\n");

  const sourceText = renderUnitsForModel(
    [...unitsById.values()].sort((left, right) => left.unitId - right.unitId),
  );

  return `LEARNING POINTS:
${pointListing}

SOURCE PASSAGES:
${sourceText}`;
}

function chunkPoints(points: LearningPoint[]) {
  const chunks: LearningPoint[][] = [];

  for (let start = 0; start < points.length; start += MAX_POINTS_PER_CARD_BATCH) {
    chunks.push(points.slice(start, start + MAX_POINTS_PER_CARD_BATCH));
  }

  return chunks;
}

/**
 * Writes one flashcard per learning point, section by section. Returns drafts grouped per
 * section in the section plan's order; near-duplicate fronts across sections are dropped.
 */
export async function writeFlashcards(params: {
  sections: StudySectionPlan[];
  notesTitle: string | null;
  languageCode?: string | null;
  context?: GenerationCallContext;
}): Promise<Array<{ section: StudySectionPlan; cards: FlashcardDraft[] }>> {
  const instructions = buildCardInstructions({
    notesTitle: params.notesTitle,
    languageCode: params.languageCode,
  });

  const batches = params.sections.flatMap((section, sectionIndex) =>
    chunkPoints(section.points).map((points) => ({ sectionIndex, points })),
  );

  const results = await mapWithConcurrency(batches, CARD_WRITE_CONCURRENCY, (batch) =>
    generateObject({
      stage: "flashcard_write",
      schema: cardBatchSchema,
      maxOutputTokens: 10_000,
      instructions,
      input: buildCardBatchInput(batch.points),
      context: params.context,
    }).then((result) => ({ ...batch, cards: result.cards })),
  );

  const pointByIndex = new Map(
    params.sections.flatMap((section) => section.points.map((point) => [point.index, point])),
  );
  const seenFronts = new Set<string>();
  const output = params.sections.map((section) => ({
    section,
    cards: [] as FlashcardDraft[],
  }));

  for (const batch of results) {
    for (const card of batch.cards) {
      const point = pointByIndex.get(card.pointIndex);

      if (!point) {
        continue;
      }

      const front = normalizeInline(card.front, 260);
      const frontKey = normalizeComparisonKey(front);

      if (!frontKey || seenFronts.has(frontKey)) {
        continue;
      }

      seenFronts.add(frontKey);
      output[batch.sectionIndex].cards.push({
        front,
        back: normalizeInline(card.back, 460),
        hint: card.hint ? normalizeInline(card.hint, 200) : null,
        difficulty: card.difficulty,
        kind: card.kind,
        point,
      });
    }
  }

  return output.filter((entry) => entry.cards.length > 0);
}
