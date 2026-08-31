import { z } from "zod";

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

/*
 * The description on `answer` is not documentation: it is sent to the model as
 * part of the response schema, which is the last thing it reads before it
 * writes. The closing question is the rule that goes missing first when an
 * answer runs long, and restating it here — at the field itself — is what makes
 * it stick.
 */
export const chatAnswerSchema = z.object({
  answer: z
    .string()
    .min(10)
    .describe(
      "The reply, in the language of the learner's last message. Simple, short enough to read " +
        "on a phone, and ending with exactly one short question unless they were only saying " +
        "thanks or goodbye.",
    ),
  citations: z.array(citationSchema).max(4),
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
