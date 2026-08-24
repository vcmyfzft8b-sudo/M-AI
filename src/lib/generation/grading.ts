import "server-only";

import { z } from "zod";

import { buildLanguageDirective } from "@/lib/generation/language";
import {
  generateObject,
  generateObjectFromFile,
  type GenerationCallContext,
} from "@/lib/generation/llm";

export const practiceGradingSchema = z.object({
  score: z.number().int().min(0).max(5),
  expectedAnswer: z.string().min(1).max(1400),
  rationale: z.string().min(1).max(1000),
  strengths: z.string().min(1).max(1000),
  missingPoints: z.string().min(1).max(1000),
  confidence: z.enum(["high", "medium", "low"]),
});

export type PracticeGrade = z.infer<typeof practiceGradingSchema>;

function buildGradingInstructions(languageCode?: string | null) {
  return `You grade one free-response answer on a practice test. Grade ONLY against the question and its answer guide — the guide's "Required:" bullets define full credit; never demand knowledge beyond it.

${buildLanguageDirective(languageCode)}

SCORE — anchor to the Required bullets the answer actually covers:
- 5: every required point present and correct (wording may differ freely).
- 4: nearly complete — one minor omission or one small imprecision.
- 3: roughly half the required points, no major misconception.
- 2: a correct core but most required points missing, or one significant error.
- 1: only a fragment of relevant correctness.
- 0: blank, off-topic, or fundamentally wrong.

FAIRNESS RULES:
- Meaning over wording: synonyms, different order, own phrasing, and correct content the guide doesn't mention all count for, never against. Ignore spelling and grammar entirely.
- Never reward fluent text that dodges the required points; confident padding earns nothing.
- If the answer is partially unreadable or ambiguous, grade what is readable and lower the confidence.

FEEDBACK — write for the student, direct and specific, in the output language:
- expectedAnswer: what a full-credit answer contains, compactly (2–5 sentences or short bullets).
- rationale: why this score — name which required points were met and which were not.
- strengths: what the student genuinely got right (if nothing, say so plainly).
- missingPoints: the concrete facts or steps that were missing or wrong — the student's to-do list.
- confidence: high | medium | low — how certain the grade is given the answer's clarity.`;
}

export async function gradeTypedAnswer(params: {
  prompt: string;
  answerGuide: string;
  typedAnswer: string;
  languageCode?: string | null;
  context?: GenerationCallContext;
}): Promise<PracticeGrade> {
  return generateObject({
    stage: "practice_grade",
    schema: practiceGradingSchema,
    maxOutputTokens: 2_400,
    instructions: buildGradingInstructions(params.languageCode),
    input: JSON.stringify(
      {
        question: params.prompt,
        answerGuide: params.answerGuide,
        studentAnswer: params.typedAnswer,
      },
      null,
      2,
    ),
    context: params.context,
  });
}

export async function gradePhotoAnswer(params: {
  file: File;
  prompt: string;
  answerGuide: string;
  languageCode?: string | null;
  context?: GenerationCallContext;
}): Promise<PracticeGrade> {
  return generateObjectFromFile({
    stage: "practice_grade_photo",
    schema: practiceGradingSchema,
    maxOutputTokens: 2_400,
    instructions: `${buildGradingInstructions(params.languageCode)}

The student's answer is the attached photo of handwritten or typed work. First read the work carefully — including crossed-out corrections (grade the final version the student kept) — then grade it exactly like a typed answer.

Question: ${params.prompt}
Answer guide: ${params.answerGuide}`,
    file: params.file,
    context: params.context,
  });
}
