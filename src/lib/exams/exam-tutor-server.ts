import "server-only";

import { z } from "zod";

import { generateStructuredObject } from "@/lib/ai/json";
import { repairPassage } from "@/lib/ai/language-check";
import { shouldCheckLanguage } from "@/lib/ai/language-repair";
import type { TutorVerdict } from "@/lib/exams/exam-model";
import { resolvePassageLanguage } from "@/lib/tutor/spoken-language";

/*
 * The tutor lesson of an exam topic: the voice tutor teaches the topic a point at a time and asks
 * about each point straight after explaining it, the way a good private tutor checks that an
 * explanation landed before moving on. An answer right at the first ask is the proof; otherwise the
 * tutor says what was missing or wrong, asks once more, and then gives the answer.
 *
 * Both calls run on the voice tutor's own model (`tutor_turn`): the learner is waiting for the
 * first line, and the topic is small enough that the fast model teaches it well from the note.
 */

export type TutorStep = {
  /** What the tutor says to teach the point: two to four spoken sentences. */
  explain: string;
  /** An open question about that point, answerable out loud in a sentence or two. */
  question: string;
  /** What a full answer contains, as a short bullet list; the marking is against it. */
  answerGuide: string;
};

export const TUTOR_STEPS = 3;

const planSchema = z.object({
  steps: z.array(z.object({ explain: z.string(), question: z.string(), answerGuide: z.string() })),
});

function clean(text: string, max: number) {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/* A spoken line's repair may take this long; past it the line is said as written. */
const REPAIR_DEADLINE_MS = 4000;

/*
 * Everything the tutor says is heard, not read, so its words are proofread the way the app's tutor
 * proofreads GLM: even the Gemini writer coins words in Slovenian now and then ("grela" for "go
 * through"), and a synthesizer pronounces them as written. The passage's own language decides the
 * check; English, and text whose language cannot be told, go out as they are.
 */
async function proofreadSpoken(text: string, language: string | null, userId: string) {
  const passageLanguage = resolvePassageLanguage(language ?? "", text);

  if (!passageLanguage || !shouldCheckLanguage(passageLanguage)) {
    return text;
  }

  const repaired = await repairPassage({
    text,
    language: passageLanguage,
    spoken: true,
    signal: AbortSignal.timeout(REPAIR_DEADLINE_MS),
    usageContext: { stage: "language_check", userId },
  }).catch(() => null);

  return repaired?.trim() || text;
}

export async function planTutorLesson(params: {
  userId: string;
  lectureId: string;
  topicTitle: string;
  summary: string;
  keyPoints: string[];
  notesMarkdown: string;
  school: string;
  /** Questions this learner has already been asked about the topic, not to be asked again. */
  avoid: string[];
}): Promise<TutorStep[]> {
  const result = await generateStructuredObject({
    schema: planSchema,
    stage: "tutor_turn",
    maxOutputTokens: 1600,
    instructions: `You are a patient private tutor preparing a student for an exam. Plan a short spoken lesson on one topic: "${params.topicTitle}".

Write exactly ${TUTOR_STEPS} steps, each about one of the topic's most important points, in the order they build on each other. The first step's explain starts with one short, warm sentence greeting the student and saying you will go through "${params.topicTitle}" point by point and ask about each one. In each step:
- explain: teach the point out loud in 2 to 4 short, clear sentences, as you would to the student sitting in front of you, with one concrete example where it helps. Plain spoken language: no lists, no formatting, no "as we saw".
- question: one open question that checks the student understood that point (not just repeated your words): ask them to explain, apply or compare. It must be answerable out loud in one or two sentences.
- answerGuide: a bullet list ("- ") of the 1 to 3 points a correct answer must contain.

Teach only what the student's note says about the topic (the input); where it is thin, use standard, well-established knowledge of the subject, never invented specifics. Do not reuse the questions under "avoid". Write in the language of the note, as a native speaking teacher would say it: natural, everyday spoken phrasing, correct grammar and real words only, never an English phrase translated word for word. Student level: ${params.school}.`,
    input: JSON.stringify({
      topic: params.topicTitle,
      summary: params.summary,
      keyPoints: params.keyPoints,
      note: params.notesMarkdown.slice(0, 12_000),
      avoid: params.avoid.slice(0, 40).map((prompt) => prompt.slice(0, 200)),
    }),
    usageContext: { stage: "exam_tutor_plan", userId: params.userId, lectureId: params.lectureId },
  });

  const steps = result.steps
    .map((step) => ({
      explain: clean(step.explain, 900),
      question: clean(step.question, 400),
      answerGuide: step.answerGuide.trim().slice(0, 800),
    }))
    .filter((step) => step.explain && step.question && step.answerGuide)
    .slice(0, TUTOR_STEPS);

  // What will be spoken is proofread, all of it at once; the answer guides are only read.
  return Promise.all(
    steps.map(async (step) => {
      const [explain, question] = await Promise.all([
        proofreadSpoken(step.explain, null, params.userId),
        proofreadSpoken(step.question, null, params.userId),
      ]);
      return { ...step, explain, question };
    }),
  );
}

const turnSchema = z.object({ verdict: z.enum(["correct", "partial", "wrong"]), speech: z.string() });

/**
 * Marks one spoken (or typed) answer and says the tutor's reply. On the first ask a reply to an
 * answer that is not right teaches what was missing and asks the question again; on the second it
 * gives the answer and moves on.
 */
export async function tutorTurn(params: {
  userId: string;
  question: string;
  answerGuide: string;
  answer: string;
  /** 1 for the first ask, 2 for the second. */
  attempt: number;
  isLast: boolean;
  /** The language the tutor speaks (the session's speech language, e.g. "sl"). */
  language: string;
}): Promise<{ verdict: TutorVerdict; speech: string; askAgain: boolean }> {
  const answer = params.answer.trim();
  const firstAsk = params.attempt <= 1;
  const result = await generateStructuredObject({
    schema: turnSchema,
    stage: "tutor_turn",
    maxOutputTokens: 400,
    instructions: `You are a warm, encouraging private tutor in a spoken lesson. You just asked the student the question in the input; their answer is a speech transcript (ignore filler words and small recognition errors) or empty if they did not know.

Mark it against the answer guide:
- "correct": it has the guide's main point(s) in the student's own words (wording does not matter, understanding does).
- "partial": it is on the right track but misses or muddles something important.
- "wrong": it is wrong, off-topic or empty.

Then say your reply, at most three short spoken sentences, no lists or formatting:
${
  firstAsk
    ? `- correct: praise briefly and specifically (what they got right).
- partial or wrong: say kindly what was missing or wrong and explain that part simply, then ask the same question again in different words.`
    : `- correct: praise briefly.
- partial or wrong: give the right answer in one or two sentences, kindly, without asking again.`
}${params.isLast ? " This is the last question: end with one short sentence closing the lesson." : ""}

Always speak in this language (ISO code): ${params.language}.`,
    input: JSON.stringify({
      question: params.question,
      answerGuide: params.answerGuide,
      studentAnswer: answer || "(no answer)",
    }),
    usageContext: { stage: "exam_tutor_turn", userId: params.userId },
  });
  // An empty answer ("I don't know") is wrong whatever the model makes of it; the reply still teaches.
  const verdict: TutorVerdict = answer ? result.verdict : "wrong";

  return {
    verdict,
    speech: await proofreadSpoken(clean(result.speech, 600), params.language, params.userId),
    askAgain: firstAsk && verdict !== "correct",
  };
}
