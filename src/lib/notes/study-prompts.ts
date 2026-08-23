import { z } from "zod";

import { buildGeneratedContentLanguageInstruction } from "../languages.ts";
import type { IndexedKnowledgeItem } from "./note-prompts.ts";

// Kept free of "server-only" so the study-material contract stays measurable
// (scripts/study-eval.mjs) outside the Next.js runtime.

/**
 * Study material is generated from the same knowledge items the notes are written from, rather
 * than from a second independent pass over the source. Two passes meant the deck could cover
 * material the notes omitted and miss material the notes taught; one shared item list makes
 * coverage of the notes and coverage of the deck the same question.
 */

/**
 * Small batches for the same reason extraction uses small windows: asked to cover sixteen items
 * at once the model quietly serves the first eight well and the rest thinly.
 */
export const STUDY_ITEM_BATCH_SIZE = 6;

/** An item this important has to be examinable somewhere, or the deck has a hole in it. */
export const STUDY_COVERAGE_IMPORTANCE_FLOOR = 3;

const citedItemId = z.number().int().nonnegative();

export const generatedFlashcardSchema = z.object({
  itemId: citedItemId,
  front: z.string().min(6).max(160),
  /**
   * One character is a whole answer in mathematics — e, 0, 1, x. A two-character floor is a prose
   * assumption, and it rejected entire flashcard batches from a production logarithms lecture.
   * Same mistake as the two-character floor that was on knowledge-item terms.
   */
  back: z.string().min(1).max(260),
  difficulty: z.enum(["easy", "medium", "hard"]),
});

export const flashcardBatchSchema = z.object({
  flashcards: z.array(generatedFlashcardSchema),
  // Named rather than silently omitted, so a hole in the deck is visible instead of inferred.
  skippedItemIds: z.array(citedItemId),
});

export const generatedQuizQuestionSchema = z.object({
  itemId: citedItemId,
  question: z.string().min(10).max(300),
  options: z.array(z.string().min(1).max(200)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  /**
   * What the learner reads after answering, and where the learning actually lands: why the
   * correct option is correct, and what makes the most tempting wrong one wrong. That is two
   * explanations, and in Slovene it does not fit in 400 characters — the cap was rejecting whole
   * batches of a production maths source and burning the retry ladder on every attempt.
   */
  explanation: z.string().min(6).max(900),
  difficulty: z.enum(["easy", "medium", "hard"]),
});

export const quizBatchSchema = z.object({
  questions: z.array(generatedQuizQuestionSchema),
  skippedItemIds: z.array(citedItemId),
});

export const generatedPracticeQuestionSchema = z.object({
  itemId: citedItemId,
  question: z.string().min(10).max(400),
  // A marking point can be a single value for the same reason a flashcard answer can.
  expectedPoints: z.array(z.string().min(1)).min(1).max(5),
});

export const practiceBatchSchema = z.object({
  questions: z.array(generatedPracticeQuestionSchema),
  skippedItemIds: z.array(citedItemId),
});

const STANDALONE_RULES = `Every prompt must stand on its own. A learner sees it with nothing else on screen: no notes, no slide, no figure, no source text.
- Never refer to the lecture, the notes, the source, the material, the text, an image, a figure, a diagram, a table, or an example.
- Never use a bare "this", "that", "it" or "these" for the subject. Name the thing.
- If the claim only makes sense with context, put that context inside the prompt itself.
- Never ask what something is "mentioned" or "described" as, or which statement is "true" in general.`;

function buildItemContract(params: { verb: string; unitNoun: string }) {
  return `You are given knowledge items, each with an id and an importance from 1 to 5. ${params.verb}

Cover every item you are given. Return the item's id on the ${params.unitNoun} that tests it.

Skip an item only when no honest standalone ${params.unitNoun} can be built from it — it is inseparable from a figure, or it is not a testable claim at all. Put those ids in skippedItemIds. Skipping an item of importance 4 or 5 needs a genuine reason; those are the ones a learner is most likely to be tested on.

Never invent a fact the item does not contain, and never soften a precise value into a vague one.

Each ${params.unitNoun} draws only on its own item. The other items in the batch are context for avoiding overlap — never a source of names, works, dates or values for this one. Pairing one item's subject with another item's facts is the worst failure this task has.`;
}

export function buildFlashcardInstructions(params: { outputLanguage?: string | null }) {
  return `${buildGeneratedContentLanguageInstruction(params.outputLanguage)}

${buildItemContract({ verb: "Write one flashcard for each.", unitNoun: "card" })}

A card tests one thing. If an item carries two facts, test the one its wording puts first and leave the other alone.

A front must have exactly one defensible answer. "What is X used for?" or "What is important about X?" can be answered five ways, so a learner who knows the material still fails the card — ask the question whose answer is the back and nothing else. If you cannot narrow it, test a different aspect of the item.

The learner must produce the answer from memory, not recognise it: never put the answer, or a phrase that gives it away, inside the front.

Fronts ask for something specific: what a term means, which term matches a definition, what a value is, what a step does, what distinguishes two things, what follows from a cause. Match the question form to the item — a definition item becomes a "what is X" card, a comparison item becomes a "how does X differ from Y" card, a procedure item becomes a "what happens when" card. Do not force every item into the same shape.

Backs are as short as the answer honestly is: a term, a value, a phrase, one sentence. A back that runs to several sentences means the front asked for too much.

Difficulty reflects the item: easy for a single term or value, medium for a mechanism or comparison, hard for something with a condition or exception attached.

${STANDALONE_RULES}`;
}

export function buildQuizInstructions(params: { outputLanguage?: string | null }) {
  return `${buildGeneratedContentLanguageInstruction(params.outputLanguage)}

${buildItemContract({
    verb: "Write one multiple-choice question for each.",
    unitNoun: "question",
  })}

Exactly four options, exactly one correct.

The question must be answerable before the options are read — a learner who knows the material should be able to say the answer, then find it in the list.

explanation is what the learner reads after answering, and it is where the learning happens: say why the correct option is correct, and then name the most tempting wrong option and say what makes it wrong. State both from the material, never "as stated above".

The three wrong options are the heart of the question. Build each one from a mistake a learner actually makes, not from a random alternative: the term they confuse this one with, the two things they swap around, the value they get by applying the wrong rule, the condition they forget. A distractor should be tempting to someone who half-learned the material and invisible to someone who learned it. Never filler, never obviously absurd, never a repeat of the correct answer in other words.

All four options must be the same kind of thing, the same grammatical shape and roughly the same length, so the correct one cannot be spotted by its form alone. Never use "all of the above", "none of the above", or an option that negates another. When the options are numbers or dates, order them.

Ask what is true, never what is "not true" or "except" — a negative stem tests reading care instead of knowledge.

Skip the item if you cannot build three plausible wrong options for it. A question with one real option and three obvious rejects teaches nothing.

${STANDALONE_RULES}`;
}

export function buildPracticeTestInstructions(params: { outputLanguage?: string | null }) {
  return `${buildGeneratedContentLanguageInstruction(params.outputLanguage)}

${buildItemContract({
    verb: "Write one open written-exam question for each.",
    unitNoun: "question",
  })}

No options. These are questions a learner answers in their own words, the way a written exam asks: explain, describe, compare, list, justify, or work through.

Ask for what the item actually supports, and reach as high as it honestly allows. The flashcards already ask the learner to recall this material, so a written question earns its place by asking them to do something with it: apply it to a case, explain why it holds, work it through, or say what follows when a condition changes. An item that is a single value does not deserve "discuss the significance of" — ask for the value and what it means. An item that is a mechanism deserves "explain how" or "explain why".

expectedPoints is the marking scheme: the specific things an answer must contain to be correct, one per point, each stated concretely enough to mark against. Not "understands the concept" but the actual claim, value or step.

${STANDALONE_RULES}`;
}

export function formatItemsForStudyGeneration(items: IndexedKnowledgeItem[]) {
  return items.map((item) => ({
    id: item.id,
    claim: item.claim,
    kind: item.kind,
    importance: item.importance,
    topic: item.sectionTitle,
  }));
}

export function chunkStudyItems<TItem extends IndexedKnowledgeItem>(
  items: TItem[],
  batchSize = STUDY_ITEM_BATCH_SIZE,
) {
  const batches: TItem[][] = [];

  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }

  return batches;
}

export type StudyCoverageReport = {
  requiredItemCount: number;
  coveredItemCount: number;
  coverage: number;
  uncoveredImportantItems: IndexedKnowledgeItem[];
};

/**
 * Coverage measured against the item list rather than against a target count: a deck is complete
 * when nothing a learner needs is missing from it, not when it reaches some number of cards.
 */
export function reportStudyCoverage(params: {
  items: IndexedKnowledgeItem[];
  coveredItemIds: number[];
  importanceFloor?: number;
}): StudyCoverageReport {
  const floor = params.importanceFloor ?? STUDY_COVERAGE_IMPORTANCE_FLOOR;
  const covered = new Set(params.coveredItemIds);
  const required = params.items.filter((item) => item.importance >= floor);
  const uncovered = required.filter((item) => !covered.has(item.id));

  return {
    requiredItemCount: required.length,
    coveredItemCount: required.length - uncovered.length,
    coverage: required.length === 0 ? 1 : (required.length - uncovered.length) / required.length,
    uncoveredImportantItems: uncovered,
  };
}
