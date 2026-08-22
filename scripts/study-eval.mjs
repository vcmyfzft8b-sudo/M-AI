/**
 * Offline study-material bake-off: flashcards, quiz questions and practice-test questions.
 *
 * Scores three things a deck can fail at independently — whether it covers the material, whether
 * each prompt stands on its own, and whether the wrong answers are worth anything — against the
 * same hand-written answer keys the note eval uses.
 *
 *   node --experimental-strip-types scripts/study-eval.mjs --fixture=synapse-en
 *   node --experimental-strip-types scripts/study-eval.mjs --variant=v2 --save
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  buildWindows,
  generate,
  GRADER_MODEL,
  ledger,
  loadEnv,
  mapWithConcurrency,
} from "./lib/eval-runtime.mjs";
import {
  buildKnowledgeExtractionInstructions,
  dedupeKnowledgeItems,
  KNOWLEDGE_EXTRACTION_PASS_WINDOWS,
  knowledgeExtractionSchema,
} from "../src/lib/notes/note-prompts.ts";
import {
  buildFlashcardInstructions,
  buildPracticeTestInstructions,
  buildQuizInstructions,
  chunkStudyItems,
  flashcardBatchSchema,
  formatItemsForStudyGeneration,
  practiceBatchSchema,
  quizBatchSchema,
  reportStudyCoverage,
} from "../src/lib/notes/study-prompts.ts";
import { resolveStageModelConfig } from "../src/lib/ai/model-config.ts";
import { buildGeneratedContentLanguageInstruction } from "../src/lib/languages.ts";
import {
  areHighQualityQuizOptions,
  isHighQualityFlashcard,
  isHighQualityStudyPrompt,
} from "../src/lib/study-quality.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "evals", "fixtures");
const OUTPUT_DIR = path.join(ROOT, "evals", "output");

loadEnv(ROOT);

/* -------------------------------------------------------------------------- */
/* Legacy pipeline: plan concepts from source units, then generate from concepts */
/* -------------------------------------------------------------------------- */

const legacyPlannerSchema = z.object({
  units: z.array(
    z.object({
      unitIndex: z.number().int().nonnegative(),
      importance: z.enum(["low", "medium", "high"]),
      concepts: z.array(
        z.object({
          conceptKey: z.string().min(2),
          conceptLabel: z.string().min(2),
          qualityScore: z.number().int().min(0).max(10),
          recommendedCardCount: z.number().int().min(1).max(3),
        }),
      ),
    }),
  ),
});

const legacyCardBatchSchema = z.object({
  flashcards: z.array(
    z.object({
      conceptKey: z.string().min(1),
      front: z.string().min(6).max(400),
      // Production caps this at 220 and burns a retry when the model overruns; the harness allows
      // the overrun through so the baseline can be scored on content rather than dying on length.
      back: z.string().min(2).max(800),
      difficulty: z.enum(["easy", "medium", "hard"]),
    }),
  ),
});

const legacyQuizBatchSchema = z.object({
  questions: z.array(
    z.object({
      conceptKey: z.string().min(1),
      question: z.string().min(10).max(300),
      options: z.array(z.string().min(1).max(200)).length(4),
      correctIndex: z.number().int().min(0).max(3),
      difficulty: z.enum(["easy", "medium", "hard"]),
    }),
  ),
});

async function runLegacyVariant(fixture, model) {
  const units = buildWindows(fixture.source, 220).map((text, unitIndex) => ({ unitIndex, text }));
  const languageInstruction = buildGeneratedContentLanguageInstruction(fixture.language);
  const batches = [];

  for (let index = 0; index < units.length; index += 6) {
    batches.push(units.slice(index, index + 6));
  }

  const planned = await mapWithConcurrency(batches, 2, (batch) =>
    generate({
      schema: legacyPlannerSchema,
      model,
      maxOutputTokens: Math.max(3200, batch.length * 760),
      instructions:
        "Create a study-worthy concept plan from the supplied source units. Quality is the gate: return concepts only when they can become high-quality standalone flashcards, quiz questions, or practice-test prompts. The final deck and quiz have strict global caps, so requested counts are maximums, never quotas. Prefer fewer excellent concepts over filler. A valid concept must test one specific fact, definition, mechanism, comparison, sequence, formula, category, or cause-effect relationship, and it must be fully supported by the source text. Return an empty concepts array for weak units, slide metadata, learning goals, repeated headings, captions, visual-only descriptions, obvious examples without a testable fact, or vague broad summaries. Assign qualityScore from 0 to 10: 10 means core, precise, self-contained, and exam-worthy; 6 means acceptable; 0-5 means weak and should usually be omitted. Default to one card per concept; recommend two only when a concept supports two clearly different high-value study angles.",
      input: JSON.stringify({ units: batch }, null, 2),
    }),
  );

  const concepts = planned
    .flatMap((batch) => batch.units)
    .flatMap((unit) =>
      unit.concepts
        .filter((concept) => concept.qualityScore >= 6)
        .map((concept) => ({ ...concept, unitIndex: unit.unitIndex })),
    );

  const conceptBatches = [];

  for (let index = 0; index < concepts.length; index += 6) {
    conceptBatches.push(concepts.slice(index, index + 6));
  }

  const [cardBatches, quizBatches] = await Promise.all([
    mapWithConcurrency(conceptBatches, 2, (batch) =>
      generate({
        schema: legacyCardBatchSchema,
        model,
        maxOutputTokens: Math.max(2600, batch.length * 560),
        instructions: `${languageInstruction}
Generate source-grounded study flashcards.
Use only the supplied source units.
Create flashcards only for requested concepts that can produce high-quality standalone cards. The requested count is a maximum, not a quota.
Prefer short, atomic cards over broad paraphrases.
Each card must test exactly one fact, definition, mechanism, comparison, sequence, formula, category, or cause-effect relationship.
Each front must be self-contained and answerable from memory without the original lecture, notes, source, material, image, table, diagram, figure, or example.
Skip a concept if the only possible card would be vague, source-dependent, visual-only, caption-like, or created only to fill the count.
Backs should usually be very short: one phrase, one sentence, one exact value, or one short list item.
Use the provided conceptKey exactly.`,
        input: JSON.stringify(
          {
            concepts: batch,
            units: units.filter((unit) => batch.some((concept) => concept.unitIndex === unit.unitIndex)),
          },
          null,
          2,
        ),
      }),
    ),
    mapWithConcurrency(conceptBatches, 2, (batch) =>
      generate({
        schema: legacyQuizBatchSchema,
        model,
        maxOutputTokens: Math.max(2200, batch.length * 520),
        instructions: `${languageInstruction}
Generate source-grounded multiple-choice quiz questions.
Use only the supplied source material.
Create questions only for requested concepts that can produce high-quality standalone multiple-choice questions.
Every question must have exactly 4 answer options and exactly 1 correct answer.
Avoid "all of the above", "none of the above", trick phrasing, and ambiguous distractors.
Follow the cover-the-options rule: the stem should be answerable before the student reads the options.
All options must be homogeneous: same category, same grammatical shape, and similar length.
Skip a question if you cannot create three plausible distractors from the same topic area.
Use the provided conceptKey exactly.`,
        input: JSON.stringify(
          {
            concepts: batch,
            units: units.filter((unit) => batch.some((concept) => concept.unitIndex === unit.unitIndex)),
          },
          null,
          2,
        ),
      }),
    ),
  ]);

  return {
    flashcards: cardBatches.flatMap((batch) => batch.flashcards),
    quiz: quizBatches.flatMap((batch) => batch.questions),
    practice: [],
    items: null,
    stages: { units: units.length, concepts: concepts.length },
  };
}

/* -------------------------------------------------------------------------- */
/* Item-driven pipeline: the notes' knowledge items are the coverage plan       */
/* -------------------------------------------------------------------------- */

async function extractItems(fixture, fallbackModel) {
  const config = resolveStageModelConfig({
    stage: "note_extract",
    env: process.env,
    fallbackModel,
  });
  const passes = KNOWLEDGE_EXTRACTION_PASS_WINDOWS.flatMap((windowWords) =>
    buildWindows(fixture.source, windowWords).map((window, index, all) => ({
      window,
      label: `Chunk ${index + 1} of ${all.length}`,
    })),
  );

  const extractions = await mapWithConcurrency(passes, 4, ({ window, label }) =>
    generate({
      schema: knowledgeExtractionSchema,
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      maxOutputTokens: Math.round(1800 * config.outputHeadroom),
      instructions: buildKnowledgeExtractionInstructions({
        outputLanguage: fixture.language,
        sourceType: fixture.sourceType,
      }),
      input: `${label}.\n\n${window}`,
    }),
  );

  const raw = extractions.flatMap((extraction) =>
    extraction.items.map((item) => ({ ...item, sectionTitle: extraction.sectionTitle })),
  );

  return dedupeKnowledgeItems(raw.map((item, id) => ({ ...item, id }))).map((item, id) => ({
    ...item,
    id,
  }));
}

async function runItemDrivenVariant(fixture, fallbackModel) {
  const items = await extractItems(fixture, fallbackModel);
  const config = resolveStageModelConfig({
    stage: "study_items",
    env: process.env,
    fallbackModel,
  });
  const batches = chunkStudyItems(items);

  const runBatches = (schema, instructions, tokensPerItem) =>
    mapWithConcurrency(batches, 3, (batch) =>
      generate({
        schema,
        model: config.model,
        thinkingLevel: config.thinkingLevel,
        maxOutputTokens: Math.round(
          Math.max(1600, batch.length * tokensPerItem) * config.outputHeadroom,
        ),
        instructions,
        input: JSON.stringify({ items: formatItemsForStudyGeneration(batch) }, null, 2),
      }),
    );

  const [cardBatches, quizBatches, practiceBatches] = await Promise.all([
    runBatches(flashcardBatchSchema, buildFlashcardInstructions({ outputLanguage: fixture.language }), 260),
    runBatches(quizBatchSchema, buildQuizInstructions({ outputLanguage: fixture.language }), 420),
    runBatches(
      practiceBatchSchema,
      buildPracticeTestInstructions({ outputLanguage: fixture.language }),
      380,
    ),
  ]);

  return {
    flashcards: cardBatches.flatMap((batch) => batch.flashcards),
    quiz: quizBatches.flatMap((batch) => batch.questions),
    practice: practiceBatches.flatMap((batch) => batch.questions),
    items,
    stages: {
      items: items.length,
      batches: batches.length,
      skippedCards: cardBatches.flatMap((batch) => batch.skippedItemIds).length,
      skippedQuiz: quizBatches.flatMap((batch) => batch.skippedItemIds).length,
    },
  };
}

const VARIANTS = {
  "v1-2.5-lite": {
    label: "current concept planner, gemini-2.5-flash-lite",
    run: (fixture) => runLegacyVariant(fixture, "gemini-2.5-flash-lite"),
  },
  v2: {
    label: "item-driven, gemini-3.5-flash-lite",
    run: (fixture) => runItemDrivenVariant(fixture, "gemini-3.5-flash-lite"),
  },
};

/* -------------------------------------------------------------------------- */
/* Grading                                                                     */
/* -------------------------------------------------------------------------- */

const factCoverageSchema = z.object({
  covered: z.array(
    z.object({ index: z.number().int().nonnegative(), present: z.boolean() }),
  ),
});

async function gradeFactCoverage(fixture, prompts) {
  const value = await generate({
    schema: factCoverageSchema,
    model: GRADER_MODEL,
    thinkingLevel: "low",
    maxOutputTokens: 8000,
    instructions:
      "You are checking whether a set of study questions and answers would teach each fact in an answer key. A fact counts as covered only if some item explicitly tests or states it. Judge meaning, not wording.",
    input: `STUDY ITEMS:\n${prompts.join("\n")}\n\nKEY FACTS:\n${fixture.keyFacts
      .map((fact, index) => `${index}. ${fact}`)
      .join("\n")}`,
  });

  const present = value.covered.filter((entry) => entry.present).length;

  return {
    recall: present / fixture.keyFacts.length,
    missed: fixture.keyFacts.filter(
      (_fact, index) => !value.covered.find((entry) => entry.index === index)?.present,
    ),
  };
}

const distractorSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      // A question fails if its wrong options are throwaway, or if more than one option is right.
      plausibleDistractors: z.boolean(),
      exactlyOneCorrect: z.boolean(),
    }),
  ),
});

async function gradeDistractors(quiz) {
  if (quiz.length === 0) {
    return { plausible: 0, singleAnswer: 0 };
  }

  const sample = quiz.slice(0, 25);
  const value = await generate({
    schema: distractorSchema,
    model: GRADER_MODEL,
    thinkingLevel: "low",
    maxOutputTokens: 6000,
    instructions:
      "Judge each multiple-choice question on two things. plausibleDistractors: would a learner who only half-knows this topic seriously consider the wrong options? Answer false if any wrong option is filler, absurd, off-topic, or obviously wrong from its form alone. exactlyOneCorrect: is the marked answer the only defensible one? Answer false if another option is also arguably correct.",
    input: sample
      .map(
        (question, index) =>
          `${index}. ${question.question}\n${question.options
            .map((option, optionIndex) => `   ${optionIndex === question.correctIndex ? "*" : "-"} ${option}`)
            .join("\n")}`,
      )
      .join("\n\n"),
  });

  return {
    plausible: value.verdicts.filter((verdict) => verdict.plausibleDistractors).length / sample.length,
    singleAnswer: value.verdicts.filter((verdict) => verdict.exactlyOneCorrect).length / sample.length,
  };
}

/** The repo's own production validators, run over the generated set. */
function scoreMechanicalQuality(outcome) {
  const badCards = outcome.flashcards.filter((card) => !isHighQualityFlashcard(card.front, card.back));
  const badQuizPrompts = outcome.quiz.filter((question) => !isHighQualityStudyPrompt(question.question));
  const badQuizOptions = outcome.quiz.filter((question) => !areHighQualityQuizOptions(question.options));
  const badPractice = outcome.practice.filter((question) => !isHighQualityStudyPrompt(question.question));

  return {
    cardRejectRate: outcome.flashcards.length ? badCards.length / outcome.flashcards.length : 0,
    quizPromptRejectRate: outcome.quiz.length ? badQuizPrompts.length / outcome.quiz.length : 0,
    quizOptionRejectRate: outcome.quiz.length ? badQuizOptions.length / outcome.quiz.length : 0,
    practiceRejectRate: outcome.practice.length ? badPractice.length / outcome.practice.length : 0,
    examples: [...badCards.slice(0, 2).map((card) => card.front), ...badQuizPrompts.slice(0, 2).map((question) => question.question)],
  };
}

/* -------------------------------------------------------------------------- */
/* Runner                                                                      */
/* -------------------------------------------------------------------------- */

const args = process.argv.slice(2);
const argValue = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const wantedVariants = argValue("variant")?.split(",") ?? Object.keys(VARIANTS);
const wantedFixtures = argValue("fixture")?.split(",");
const shouldSave = args.includes("--save");

const fixtures = fs
  .readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")))
  .filter((fixture) => !wantedFixtures || wantedFixtures.includes(fixture.id));

if (shouldSave) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const results = [];

for (const fixture of fixtures) {
  for (const variantKey of wantedVariants) {
    const variant = VARIANTS[variantKey];

    if (!variant) {
      throw new Error(`Unknown variant "${variantKey}"`);
    }

    process.stdout.write(`running ${fixture.id} / ${variantKey} ... `);

    const before = { ...ledger };
    let outcome;

    try {
      outcome = await variant.run(fixture);
    } catch (error) {
      console.log(`FAILED: ${error.message}`);
      results.push({ fixture: fixture.id, variant: variantKey, error: error.message });
      continue;
    }

    const cost = ledger.costUsd - before.costUsd;
    const prompts = [
      ...outcome.flashcards.map((card) => `Q: ${card.front}\nA: ${card.back}`),
      ...outcome.quiz.map(
        (question) => `Q: ${question.question}\nA: ${question.options[question.correctIndex]}`,
      ),
      ...outcome.practice.map(
        (question) => `Q: ${question.question}\nA: ${question.expectedPoints.join("; ")}`,
      ),
    ];

    const [factCoverage, distractors] = await Promise.all([
      gradeFactCoverage(fixture, prompts),
      gradeDistractors(outcome.quiz),
    ]);

    const itemCoverage = outcome.items
      ? reportStudyCoverage({
          items: outcome.items,
          coveredItemIds: [
            ...outcome.flashcards.map((card) => card.itemId),
            ...outcome.quiz.map((question) => question.itemId),
          ],
        })
      : null;

    console.log(
      `${outcome.flashcards.length} cards, ${outcome.quiz.length} quiz, fact recall ${(
        factCoverage.recall * 100
      ).toFixed(0)}%`,
    );

    results.push({
      fixture: fixture.id,
      variant: variantKey,
      cards: outcome.flashcards.length,
      quiz: outcome.quiz.length,
      practice: outcome.practice.length,
      factRecall: factCoverage.recall,
      missed: factCoverage.missed,
      itemCoverage: itemCoverage?.coverage ?? null,
      uncoveredImportant: itemCoverage?.uncoveredImportantItems.map((item) => item.claim) ?? [],
      distractors,
      mechanical: scoreMechanicalQuality(outcome),
      stages: outcome.stages,
      costUsd: cost,
    });

    if (shouldSave) {
      fs.writeFileSync(
        path.join(OUTPUT_DIR, `study.${fixture.id}.${variantKey}.json`),
        JSON.stringify(outcome, null, 2),
      );
    }
  }
}

console.log("\n");
console.log(
  ["fixture", "variant", "cards", "quiz", "prac", "fact recall", "item cov", "distract", "1 answer", "rejects", "cost"]
    .map((header, index) => header.padEnd([14, 13, 6, 6, 6, 12, 9, 9, 9, 8, 8][index]))
    .join(""),
);

for (const row of results) {
  if (row.error) {
    console.log(`${row.fixture.padEnd(14)}${row.variant.padEnd(13)}ERROR ${row.error}`);
    continue;
  }

  const rejects =
    row.mechanical.cardRejectRate + row.mechanical.quizPromptRejectRate + row.mechanical.practiceRejectRate;

  console.log(
    [
      row.fixture.padEnd(14),
      row.variant.padEnd(13),
      String(row.cards).padEnd(6),
      String(row.quiz).padEnd(6),
      String(row.practice).padEnd(6),
      `${(row.factRecall * 100).toFixed(0)}%`.padEnd(12),
      (row.itemCoverage == null ? "-" : `${(row.itemCoverage * 100).toFixed(0)}%`).padEnd(9),
      `${(row.distractors.plausible * 100).toFixed(0)}%`.padEnd(9),
      `${(row.distractors.singleAnswer * 100).toFixed(0)}%`.padEnd(9),
      `${(rejects * 100).toFixed(0)}%`.padEnd(8),
      `$${row.costUsd.toFixed(4)}`.padEnd(8),
    ].join(""),
  );
}

console.log("\nDetail:");

for (const row of results) {
  if (row.error) {
    continue;
  }

  console.log(`\n  ${row.fixture} / ${row.variant} — ${JSON.stringify(row.stages)}`);
  console.log(`    mechanical rejects: ${JSON.stringify(row.mechanical)}`);

  if (row.missed.length > 0) {
    console.log(`    key facts no study item tests (${row.missed.length}):`);

    for (const fact of row.missed.slice(0, 8)) {
      console.log(`      - ${fact}`);
    }
  }

  if (row.uncoveredImportant.length > 0) {
    console.log(`    important items with no card or question (${row.uncoveredImportant.length}):`);

    for (const claim of row.uncoveredImportant.slice(0, 5)) {
      console.log(`      - ${claim}`);
    }
  }
}

console.log(
  `\ntotal: ${ledger.calls} calls, $${ledger.costUsd.toFixed(4)} (grading included)`,
);
