import "server-only";

import { z } from "zod";

import { generateStructuredObject } from "@/lib/ai/json";

/*
 * The oral mock exam's examiner, as Astra runs it: a voice that asks the exam's questions, listens,
 * and after each answer either asks one short follow-up about what was missing or moves on. The
 * questions and their marking guides are the attempt's snapshot; the examiner never says whether
 * an answer was right (the grading at the end does that) and never gives the answer away.
 */

export type OralVibe = "strict" | "friendly" | "encouraging";

const VIBE: Record<OralVibe, string> = {
  strict:
    "A strict examiner: formal, brief and neutral. No praise, no small talk. Presses for precision the way a demanding professor does.",
  friendly: "A friendly examiner: calm and warm, puts the student at ease, still exam-like and brief.",
  encouraging: "An encouraging examiner: upbeat and supportive, keeps the student's confidence up, still brief.",
};

const turnSchema = z.object({ speech: z.string(), followUp: z.boolean() });

export async function examinerTurn(params: {
  userId: string;
  vibe: OralVibe;
  question: string;
  answerGuide: string;
  answer: string;
  alreadyFollowedUp: boolean;
  isLast: boolean;
  /** The language the examiner speaks (the session's speech language, e.g. "sl"). */
  language: string;
}) {
  const result = await generateStructuredObject({
    schema: turnSchema,
    stage: "tutor_turn",
    maxOutputTokens: 300,
    instructions: `You are the examiner in a spoken (oral) exam. ${VIBE[params.vibe]}

The student has just answered the question in the input (their answer is a speech transcript, so ignore filler words and small recognition errors). Compare it with the marking guide.

- If the answer misses or muddles an important point of the guide and followUpAllowed is true, ask ONE short follow-up question that makes the student address that point, without revealing it. Set followUp to true.
- Otherwise say one short neutral sentence that closes this question${params.isLast ? " and the exam" : " and moves on to the next one"}. Set followUp to false.

Never judge the answer out loud: no "correct", "right", "good", "fine", "that is enough" or the like in any language (the grade comes at the end), and never reveal anything from the marking guide.

Speak naturally, at most two short sentences, no lists or formatting. Always speak in this language (ISO code): ${params.language}, even when the student said nothing.`,
    input: JSON.stringify({
      question: params.question,
      markingGuide: params.answerGuide,
      studentAnswer: params.answer || "(no answer)",
      followUpAllowed: !params.alreadyFollowedUp && params.answer.trim().length > 0,
    }),
    usageContext: { stage: "exam_oral_turn", userId: params.userId },
  });

  return {
    speech: result.speech.replace(/\s+/g, " ").trim().slice(0, 400),
    followUp: result.followUp && !params.alreadyFollowedUp,
  };
}
