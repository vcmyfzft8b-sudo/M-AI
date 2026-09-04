/**
 * Offline check that the practice-test grader marks the way a teacher would.
 *
 * Runs the shipped grading prompt and the shipped score arithmetic against hand-marked student
 * answers whose grade is not in doubt — a complete answer in the learner's own words, the same
 * answer typed without diacritics, half of it, one confidently wrong claim, a fluent answer to a
 * different question, and an answer that asks the grader for full marks. Each carries the band a
 * teacher would put it in; the run fails if a mark lands outside its band.
 *
 * Every answer is marked `--repeats` times, because a grader that gives the same answer a 4 and
 * then a 2 is not a grader whatever its average looks like.
 *
 *   node --experimental-strip-types scripts/grading-eval.mjs
 *   node --experimental-strip-types scripts/grading-eval.mjs --repeats=3 --case=enzyme-sl
 *   node --experimental-strip-types scripts/grading-eval.mjs --baseline   # the grader this replaced
 *
 * `--baseline` runs the grader that shipped before 2026-09-04 — one call asking the model for a
 * number out of five against a prose answer guide — on the same answers, so the change is
 * measured rather than asserted.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { generate, ledger, loadEnv, mapWithConcurrency } from "./lib/eval-runtime.mjs";
import {
  buildPracticeGradingInstructions,
  practiceGradingSchema,
} from "../src/lib/notes/study-prompts.ts";
import {
  reconcilePointMarks,
  scoreFromRubric,
  truncateAnswerForGrading,
} from "../src/lib/practice-test-scoring.ts";
import { resolveStageModelConfig } from "../src/lib/ai/model-config.ts";
import { detectSourceLanguage } from "../src/lib/languages.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadEnv(ROOT);

const args = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, value] = argument.replace(/^--/, "").split("=");
    return [key, value ?? "true"];
  }),
);

const REPEATS = Number.parseInt(args.get("repeats") ?? "2", 10);
const BASELINE = args.get("baseline") === "true";
const ONLY_CASE = args.get("case") ?? null;
const CONCURRENCY = Number.parseInt(args.get("concurrency") ?? "6", 10);

const fixture = JSON.parse(
  // Deliberately not under evals/fixtures: note-eval and study-eval load every .json in that
  // directory as a source fixture, and these are marked answers rather than source material.
  fs.readFileSync(path.join(ROOT, "evals", "grading", "practice-grading.json"), "utf8"),
);

const stage = resolveStageModelConfig({
  stage: "study_items",
  env: process.env,
  fallbackModel: process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash-lite",
});
const MODEL = args.get("model") ?? stage.model;

/** A transient network failure is not a grading result; production retries too. */
async function withRetry(run) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= 2) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
}

/**
 * The grader that shipped before the rubric: one call, a prose answer guide, and "return an
 * integer score from 0 to 5". Kept here and nowhere else — it is the baseline the current numbers
 * are measured against, not code the product can reach.
 */
const baselineSchema = z.object({
  score: z.number().int().min(0).max(5),
  expectedAnswer: z.string().min(1),
  rationale: z.string().min(1),
  strengths: z.string(),
  missingPoints: z.string(),
  confidence: z.string(),
});

const BASELINE_INSTRUCTIONS = `Grade the student's free-response answer using the supplied answer guide.
Return an integer score from 0 to 5.
Scoring anchors:
- 0: blank, unknown, or fundamentally incorrect
- 1: very weak answer with only slight correctness
- 2: limited partial understanding
- 3: mostly correct but incomplete or mixed
- 4: almost fully correct with minor omissions
- 5: fully correct and complete
Do not be generous with unsupported claims.
ExpectedAnswer should describe what a strong answer needed to include.
Rationale should explain the score clearly.
Strengths should mention what the student got right.
MissingPoints should mention what was absent or incorrect.`;

async function markOnceWithBaseline(testCase, answer) {
  const graded = await withRetry(() =>
    generate({
      schema: baselineSchema,
      instructions: BASELINE_INSTRUCTIONS,
      input: JSON.stringify(
        {
          prompt: testCase.question,
          answerGuide: testCase.markingPoints.map((point) => `- ${point}`).join("\n"),
          studentAnswer: answer.text,
        },
        null,
        2,
      ),
      model: MODEL,
      maxOutputTokens: 1600,
      thinkingLevel: stage.thinkingLevel,
    }),
  );

  return {
    score: graded.score,
    marks: [],
    feedback: [graded.rationale, graded.missingPoints, graded.strengths].filter(Boolean).join(" "),
  };
}

/** One marking run, through exactly the path the product takes. */
async function markOnce(testCase, answer) {
  const marked = await withRetry(() => generate({
    schema: practiceGradingSchema,
    instructions: buildPracticeGradingInstructions(),
    input: JSON.stringify(
      {
        question: testCase.question,
        markingPoints: testCase.markingPoints.map((point, index) => ({
          pointIndex: index,
          point,
        })),
        studentAnswer: `<student-answer>\n${truncateAnswerForGrading(answer.text)}\n</student-answer>`,
      },
      null,
      2,
    ),
    model: MODEL,
    maxOutputTokens: 1600,
    thinkingLevel: stage.thinkingLevel,
  }));

  const marks = reconcilePointMarks({
    pointCount: testCase.markingPoints.length,
    marks: marked.pointMarks,
  });

  return {
    ...scoreFromRubric({
      marks,
      criticalError: marked.criticalError,
      offTopic: marked.offTopic,
    }),
    marks,
    feedback: [marked.rationale, marked.missingPoints, marked.strengths]
      .filter(Boolean)
      .join(" "),
  };
}

const cases = ONLY_CASE ? fixture.cases.filter((entry) => entry.id === ONLY_CASE) : fixture.cases;
const jobs = cases.flatMap((testCase) =>
  testCase.answers.flatMap((answer) =>
    Array.from({ length: REPEATS }, (_, run) => ({ testCase, answer, run })),
  ),
);

console.log(
  `grading eval · ${BASELINE ? "baseline (pre-rubric) grader" : "shipping rubric grader"} · ` +
    `model ${MODEL} · ${jobs.length} marking runs\n`,
);

const results = await mapWithConcurrency(jobs, CONCURRENCY, async (job) => {
  try {
    const mark = BASELINE ? markOnceWithBaseline : markOnce;

    return { job, marked: await mark(job.testCase, job.answer) };
  } catch (error) {
    return { job, error: error instanceof Error ? error.message : String(error) };
  }
});

const byAnswer = new Map();

for (const result of results) {
  const key = `${result.job.testCase.id}::${result.job.answer.id}`;
  byAnswer.set(key, [...(byAnswer.get(key) ?? []), result]);
}

let failures = 0;
let unstable = 0;
let wrongLanguage = 0;

for (const testCase of cases) {
  console.log(`\n${testCase.id}  (${testCase.markingPoints.length} marking points)`);

  for (const answer of testCase.answers) {
    const runs = byAnswer.get(`${testCase.id}::${answer.id}`) ?? [];
    const errored = runs.filter((run) => run.error);
    const scores = runs.filter((run) => run.marked).map((run) => run.marked.score);
    const [low, high] = answer.expect;
    const outside = scores.filter((score) => score < low || score > high);
    const spread = scores.length ? Math.max(...scores) - Math.min(...scores) : 0;
    /*
     * Feedback has to come back in the language the question and the scheme are written in,
     * whatever language the student answered in. What is checked is the failure that actually
     * happens — falling back to English because the instructions are in English. Slovene against
     * Croatian is not checked here: the detector separates those on orthography, which one short
     * sentence of feedback does not carry reliably.
     */
    const languages = runs
      .filter((run) => run.marked?.feedback)
      .map((run) => detectSourceLanguage(run.marked.feedback));
    const foreign = languages.filter(
      (language) => language === "en" && testCase.language !== "en",
    );

    if (outside.length > 0 || errored.length > 0) {
      failures += 1;
    }

    if (spread > 1) {
      unstable += 1;
    }

    if (foreign.length > 0) {
      wrongLanguage += 1;
    }

    const verdict =
      errored.length > 0
        ? "ERROR"
        : outside.length > 0
          ? "FAIL "
          : spread > 1
            ? "SHAKY"
            : "ok   ";

    console.log(
      `  ${verdict} ${answer.id.padEnd(16)} scored ${scores.join("/") || "-"}` +
        `  expected ${low}-${high}` +
        (foreign.length ? `  feedback in ${foreign[0]}` : "") +
        (errored.length ? `  ${errored[0].error}` : ""),
    );
  }
}

console.log(
  `\n${jobs.length} runs · ${failures} outside band · ${unstable} unstable · ` +
    `${wrongLanguage} wrong-language · $${ledger.costUsd.toFixed(4)}`,
);

process.exit(failures > 0 || wrongLanguage > 0 ? 1 : 0);
