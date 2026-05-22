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

function cleanBoundedString(maxLength: number) {
  return (value: unknown) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();

    return trimmed.length > maxLength ? trimmed.slice(0, maxLength).trim() : trimmed;
  };
}

function limitArray(maxLength: number) {
  return (value: unknown) => {
    if (!Array.isArray(value)) {
      return value;
    }

    return value.slice(0, maxLength);
  };
}

const shortEvidenceSchema = z.preprocess(cleanBoundedString(320), z.string().min(8).max(320));
const repairInstructionsSchema = z.preprocess(
  cleanBoundedString(1800),
  z.string().min(20).max(1800),
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

export const noteCoverageUnitSchema = z.object({
  category: z.enum([
    "concept",
    "definition",
    "formula",
    "example",
    "comparison",
    "process",
    "warning",
    "exercise",
    "ocr_addition",
  ]),
  heading: z.string().min(3),
  details: z.preprocess(limitArray(6), z.array(z.string().min(10)).min(1).max(6)),
  sourceEvidence: shortEvidenceSchema,
  importance: z.enum(["core", "supporting", "context"]),
  needsExplanation: z.boolean(),
});

export const noteCoverageExtractionSchema = z.object({
  units: z.preprocess(limitArray(40), z.array(noteCoverageUnitSchema).max(40)),
});

export const noteArtifactSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(40),
  keyTopics: z.array(z.string().min(2)).min(3).max(16),
  structuredNotesMd: z.string().min(300),
});

export const noteCoverageReviewSchema = z.object({
  coveredUnitHeadings: z.array(z.string().min(3)),
  missingUnitHeadings: z.array(z.string().min(3)),
  shallowExplanationHeadings: z.array(z.string().min(3)),
  unsupportedClaims: z.preprocess(limitArray(8), z.array(z.string().min(8)).max(8)),
  repeatedOrLowValueSections: z.preprocess(limitArray(8), z.array(z.string().min(8)).max(8)),
  overExpandedSections: z.preprocess(limitArray(8), z.array(z.string().min(8)).max(8)),
  needsRepair: z.boolean(),
  repairInstructions: repairInstructionsSchema,
});

export const chatAnswerSchema = z.object({
  answer: z.string().min(10),
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
