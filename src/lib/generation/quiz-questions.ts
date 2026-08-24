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

export const QUIZ_PIPELINE_VERSION = "quiz-v3-learning-points";

const QUIZ_WRITE_CONCURRENCY = 4;
const MAX_POINTS_PER_QUIZ_BATCH = 8;
export const MAX_QUIZ_QUESTIONS = 30;
export const MIN_QUIZ_QUESTIONS = 5;

export type QuizQuestionDraft = {
  prompt: string;
  options: string[];
  correctOptionIdx: number;
  explanation: string;
  difficulty: FlashcardDifficulty;
  point: LearningPoint;
};

const quizItemSchema = z.object({
  pointIndex: z.number().int().min(0),
  prompt: z.string().min(10).max(420),
  correctAnswer: z.string().min(1).max(260),
  distractors: z.array(z.string().min(1).max(260)).length(3),
  explanation: z.string().min(10).max(700),
  difficulty: z.enum(["easy", "medium", "hard"]),
});

const quizBatchSchema = z.object({
  questions: z.array(quizItemSchema).min(1).max(MAX_POINTS_PER_QUIZ_BATCH),
});

function buildQuizInstructions(params: {
  notesTitle: string | null;
  languageCode?: string | null;
}) {
  return `You write multiple-choice questions${
    params.notesTitle ? ` for the material "${params.notesTitle}"` : ""
  }. You get numbered learning points plus the source passages they came from. Write EXACTLY ONE question per learning point, tagged with its pointIndex.

${buildLanguageDirective(params.languageCode)}

QUESTION CRAFT:
- prompt: a complete, specific question a student can answer from mastery of the material — test understanding or application where the point allows it, not just word-matching. Never "Which statement is true?" grab-bags, and never questions about the lecture itself ("What did the professor mention?").
- correctAnswer: the one unambiguously correct answer. Keep it tight; it must not be correct merely "most of the time" while a distractor is defensible.
- distractors: exactly 3, and this is where the question earns its value — each must be the answer a student with a SPECIFIC misunderstanding would pick: a confused neighbouring concept, a right-sounding wrong mechanism, a common calculation slip, a true statement that doesn't answer this question. All four options must be the same type of thing, similar length and grammar, so nothing gives the answer away. Never "all of the above", "none of the above", or joke options.
- explanation: 1–3 sentences: why the correct answer is right, and what mistake the most tempting distractor represents. Written to teach, not to gloat.
- difficulty: easy = recognising one fact · medium = understanding a relationship · hard = applying or combining knowledge.
- Plain text only: no markdown, no LaTeX. Formulas in readable plain notation ("F = m·a", "√", "²").`;
}

function buildQuizBatchInput(points: LearningPoint[]) {
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

/** Deterministically spreads correct answers across positions so no slot is over-represented. */
function assignOptionOrder(draft: {
  correctAnswer: string;
  distractors: string[];
  questionIndex: number;
}) {
  const correctOptionIdx = draft.questionIndex % 4;
  const options = [...draft.distractors];
  options.splice(correctOptionIdx, 0, draft.correctAnswer);

  return { options, correctOptionIdx };
}

export async function writeQuizQuestions(params: {
  points: LearningPoint[];
  notesTitle: string | null;
  languageCode?: string | null;
  context?: GenerationCallContext;
}): Promise<QuizQuestionDraft[]> {
  const importanceRank = { core: 0, supporting: 1, detail: 2 } as const;
  const targetCount = clamp(
    params.points.filter((point) => point.importance !== "detail").length,
    Math.min(MIN_QUIZ_QUESTIONS, params.points.length),
    MAX_QUIZ_QUESTIONS,
  );

  // Prefer core points, then supporting, but quiz in source order so sessions flow like the material.
  const selected = [...params.points]
    .sort(
      (left, right) =>
        importanceRank[left.importance] - importanceRank[right.importance] ||
        left.index - right.index,
    )
    .slice(0, targetCount)
    .sort((left, right) => left.index - right.index);

  const batches: LearningPoint[][] = [];
  for (let start = 0; start < selected.length; start += MAX_POINTS_PER_QUIZ_BATCH) {
    batches.push(selected.slice(start, start + MAX_POINTS_PER_QUIZ_BATCH));
  }

  const instructions = buildQuizInstructions({
    notesTitle: params.notesTitle,
    languageCode: params.languageCode,
  });

  const results = await mapWithConcurrency(batches, QUIZ_WRITE_CONCURRENCY, (batch) =>
    generateObject({
      stage: "quiz_write",
      schema: quizBatchSchema,
      maxOutputTokens: 10_000,
      instructions,
      input: buildQuizBatchInput(batch),
      context: params.context,
    }),
  );

  const pointByIndex = new Map(selected.map((point) => [point.index, point]));
  const seenPrompts = new Set<string>();
  const drafts: QuizQuestionDraft[] = [];

  for (const batch of results) {
    for (const item of batch.questions) {
      const point = pointByIndex.get(item.pointIndex);

      if (!point) {
        continue;
      }

      const prompt = normalizeInline(item.prompt, 420);
      const promptKey = normalizeComparisonKey(prompt);
      const correctAnswer = normalizeInline(item.correctAnswer, 260);
      const distractors = item.distractors.map((value) => normalizeInline(value, 260));
      const optionKeys = new Set(
        [correctAnswer, ...distractors].map((value) => normalizeComparisonKey(value)),
      );

      // A question with colliding options or a recycled prompt confuses more than it teaches.
      if (!promptKey || seenPrompts.has(promptKey) || optionKeys.size !== 4) {
        continue;
      }

      seenPrompts.add(promptKey);

      const { options, correctOptionIdx } = assignOptionOrder({
        correctAnswer,
        distractors,
        questionIndex: drafts.length,
      });

      drafts.push({
        prompt,
        options,
        correctOptionIdx,
        explanation: normalizeInline(item.explanation, 700),
        difficulty: item.difficulty,
        point,
      });
    }
  }

  return drafts;
}
