import { z } from "zod";

import { CHAT_STUDY_KINDS } from "../chat-study-set.ts";

const OPTIONAL_EXAMPLE_MIN_LENGTH = 12;

function cleanOptionalExamples(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  return value
    .map((example) => (typeof example === "string" ? example.trim() : example))
    .filter(
      (example): example is string =>
        typeof example === "string" && example.length >= OPTIONAL_EXAMPLE_MIN_LENGTH,
    );
}

const optionalExamplesSchema = z.preprocess(
  cleanOptionalExamples,
  z.array(z.string().min(OPTIONAL_EXAMPLE_MIN_LENGTH)),
);

export const citationSchema = z.object({
  idx: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  quote: z.string().min(3),
});

export const chunkSummarySchema = z.object({
  heading: z.string().min(3),
  summary: z.string().min(60),
  bulletPoints: z.array(z.string().min(12)).min(5),
  supportingDetails: z.array(z.string().min(12)).min(2),
  examples: optionalExamplesSchema,
  terminology: z.array(z.string().min(2)).min(3),
});

export const noteArtifactSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(40),
  keyTopics: z.array(z.string().min(2)).min(6),
  structuredNotesMd: z.string().min(300),
});

/**
 * What the chat model fills when the learner asks it to make a study set, and leaves null
 * otherwise. Shared by both chats; the set itself is written by a second call
 * (chat-study-generation.ts) and attached under the reply.
 *
 * The descriptions are the instruction. They travel to the model with the schema, which is where
 * a model looks when deciding whether to fill a field at all, and they name the words learners
 * actually use, in the languages they use them, because "kartice" is not obviously "flashcards".
 */
export const chatStudyRequestSchema = z
  .object({
    kind: z
      .enum(CHAT_STUDY_KINDS)
      .describe(
        "flashcards: cards to flip (kartice, flashcards). quiz: multiple-choice questions (kviz). "
          + "test: open questions to answer in their own words (a test, exam or practice "
          + "questions, vprašanja za izpit, pitanja). mindmap: a mind map or concept map "
          + "(miselni vzorec, mentalna mapa, umna mapa).",
      ),
    count: z
      .number()
      .int()
      .nullable()
      .describe("How many cards or questions they asked for, or null when they did not say."),
    focus: z
      .string()
      .describe(
        "What the set should cover, in a few words: the topic they named, or the subject of the "
          + "conversation when they said \"this\" or \"it\".",
      ),
  })
  .nullable()
  .describe(
    "Fill this ONLY when the learner's latest message asks you to make, give or quiz them with "
      + "flashcards, a quiz, a test or practice questions, or a mind map. The app then builds "
      + "that set and shows it under your reply as real interactive cards. Null for everything "
      + "else, including a question about one of these, a request to explain something, or a "
      + "summary.",
  );

/*
 * The description on `answer` is not documentation: it is sent to the model as
 * part of the response schema, which is the last thing it reads before it
 * writes. Brevity and the closing question are the two rules that go missing
 * first when an answer runs long, and restating them here — at the field
 * itself — is what makes them stick.
 *
 * The floor is one character rather than the ten it used to be. A ten-character
 * minimum is not a quality bar, it is a trap for the shortest correct reply —
 * "Ja, drži." is nine — and now that the tutor is told to answer in as few words
 * as the question takes, the trap is one it will walk into more often. Failing
 * validation there spends the retry ladder on a good answer and can end with the
 * learner seeing an error instead of it.
 */
export const chatAnswerSchema = z.object({
  answer: z
    .string()
    .min(1)
    .describe(
      "The reply, in the language of the learner's last message, written as Markdown: a blank "
        + "line between paragraphs, \"- \" for a genuine list, **bold** for the one term that "
        + "matters. It opens with the answer itself — no preamble — and is around 60 words and "
        + "never more than 120. It ends with exactly one short question unless they were only "
        + "saying thanks or goodbye, or filled studyRequest.",
    ),
  citations: z.array(citationSchema).max(4),
  studyRequest: chatStudyRequestSchema,
});

export const flashcardSchema = z.object({
  front: z.string().min(6).max(120),
  back: z.string().min(12).max(220),
  hint: z.string().min(6).max(180).nullable(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  citations: z.array(citationSchema).min(1).max(2),
});

export function createFlashcardDeckSchema(cardCount: number) {
  return z.object({
    flashcards: z.array(flashcardSchema).length(cardCount),
  });
}
