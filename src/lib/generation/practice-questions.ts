import "server-only";

import { z } from "zod";

import type { FlashcardDifficulty } from "@/lib/database.types";
import { buildLanguageDirective } from "@/lib/generation/language";
import { generateObject, type GenerationCallContext } from "@/lib/generation/llm";
import type { LearningPoint } from "@/lib/generation/learning-points";
import { renderUnitsForModel, type SourceUnit } from "@/lib/generation/source";
import {
  clamp,
  mapWithConcurrency,
  normalizeComparisonKey,
  normalizeInline,
} from "@/lib/generation/util";

export const PRACTICE_TEST_PIPELINE_VERSION = "practice-test-v3";

const PRACTICE_WRITE_CONCURRENCY = 3;
const POINTS_PER_PRACTICE_BATCH = 10;
export const MAX_PRACTICE_QUESTIONS = 30;
export const MIN_PRACTICE_QUESTIONS = 4;

export type PracticeQuestionDraft = {
  prompt: string;
  answerGuide: string;
  difficulty: FlashcardDifficulty;
  conceptKey: string;
  sourceUnitIdx: number;
  sourceLocator: string | null;
};

const practiceItemSchema = z.object({
  pointIndexes: z.array(z.number().int().min(0)).min(1).max(6),
  prompt: z.string().min(12).max(480),
  answerGuide: z.string().min(40).max(1600),
  difficulty: z.enum(["easy", "medium", "hard"]),
});

const practiceBatchSchema = z.object({
  questions: z.array(practiceItemSchema).min(1).max(12),
});

function buildPracticeInstructions(params: {
  notesTitle: string | null;
  languageCode?: string | null;
  questionTarget: number;
}) {
  return `You write free-response exam questions${
    params.notesTitle ? ` for the material "${params.notesTitle}"` : ""
  }. You get numbered learning points plus their source passages. Write about ${params.questionTarget} questions that together examine this batch of points. A question may span several related points (list them all in pointIndexes); every core point must be examined by some question.

${buildLanguageDirective(params.languageCode)}

QUESTION CRAFT:
- Write questions the way a good exam does, mixing levels: define/state precisely · explain a mechanism or why something holds · compare two things · apply the knowledge to a small concrete scenario or calculation. Prefer explain/apply over bare recall whenever the points allow it.
- prompt: specific and self-contained (a student sees only the prompt), answerable in 2–10 sentences or a short worked calculation. Never "discuss X" essays and never questions about the recording itself.
- answerGuide: the grading rubric for this question, structured exactly as:
  first a line "Required:" followed by "-" bullets — each bullet one fact, step, or conclusion a full-credit answer must contain (3–7 bullets);
  then a line "Partial credit:" with one sentence on what a half-right answer typically includes.
  The guide must be complete enough that a grader who never saw the source can grade with it. Plain text, no markdown beyond the "-" bullets, no LaTeX; formulas in plain notation ("F = m·a").
- difficulty: easy = state/define · medium = explain/compare · hard = apply/derive.`;
}

function buildPracticeBatchInput(points: LearningPoint[]) {
  const unitsById = new Map<number, SourceUnit>();

  for (const point of points) {
    for (const unit of point.units) {
      unitsById.set(unit.unitId, unit);
    }
  }

  const pointListing = points
    .map((point) => `${point.index}. [${point.kind}, ${point.importance}] ${point.statement}`)
    .join("\n");

  return `LEARNING POINTS:
${pointListing}

SOURCE PASSAGES:
${renderUnitsForModel([...unitsById.values()].sort((left, right) => left.unitId - right.unitId))}`;
}

export async function writePracticeQuestions(params: {
  points: LearningPoint[];
  notesTitle: string | null;
  languageCode?: string | null;
  context?: GenerationCallContext;
}): Promise<PracticeQuestionDraft[]> {
  // Details rarely deserve a free-response question; core and supporting points carry the exam.
  const examPoints = params.points.filter((point) => point.importance !== "detail");
  const pool = examPoints.length >= MIN_PRACTICE_QUESTIONS ? examPoints : params.points;

  const batches: LearningPoint[][] = [];
  for (let start = 0; start < pool.length; start += POINTS_PER_PRACTICE_BATCH) {
    batches.push(pool.slice(start, start + POINTS_PER_PRACTICE_BATCH));
  }

  const pointByIndex = new Map(pool.map((point) => [point.index, point]));

  const results = await mapWithConcurrency(batches, PRACTICE_WRITE_CONCURRENCY, (batch) =>
    generateObject({
      stage: "practice_write",
      schema: practiceBatchSchema,
      maxOutputTokens: 12_000,
      instructions: buildPracticeInstructions({
        notesTitle: params.notesTitle,
        languageCode: params.languageCode,
        questionTarget: clamp(Math.ceil(batch.length * 0.7), 3, 8),
      }),
      input: buildPracticeBatchInput(batch),
      context: params.context,
    }),
  );

  const seenPrompts = new Set<string>();
  const drafts: PracticeQuestionDraft[] = [];

  for (const batch of results) {
    for (const item of batch.questions) {
      const anchorPoints = item.pointIndexes
        .map((index) => pointByIndex.get(index))
        .filter((point): point is LearningPoint => Boolean(point));

      if (anchorPoints.length === 0) {
        continue;
      }

      const prompt = normalizeInline(item.prompt, 480);
      const promptKey = normalizeComparisonKey(prompt);

      if (!promptKey || seenPrompts.has(promptKey)) {
        continue;
      }

      seenPrompts.add(promptKey);

      const primary = anchorPoints[0];
      const primaryUnit = primary.units[0];

      drafts.push({
        prompt,
        answerGuide: item.answerGuide.replace(/\n{3,}/g, "\n\n").trim(),
        difficulty: item.difficulty,
        conceptKey: primary.conceptKey,
        sourceUnitIdx: primaryUnit?.unitId ?? 0,
        sourceLocator: primaryUnit?.locatorLabel ?? null,
      });
    }
  }

  return drafts.slice(0, MAX_PRACTICE_QUESTIONS);
}
