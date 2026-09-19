/**
 * Offline rehearsal of the note chat.
 *
 * The chat is the one part of the product a learner talks to, and the four things that decide
 * whether it feels like a tutor cannot be seen in a diff:
 *
 *   1. Is the answer short? Not "reasonably short" — a number, because the difference between
 *      60 words and 200 on a phone is the difference between reading it and scrolling past it.
 *   2. Does it start with the answer, or with a paragraph warming up to one?
 *   3. Is it true — of their material where the material covers it, and of the world where it
 *      does not?
 *   4. Is it in the language they asked in? Slovenian answered in Croatian is a bug a Slovenian
 *      speaker notices immediately and an English-speaking reviewer never sees.
 *
 * It runs the real prompt, the real schema and the real chat-stage model against a committed
 * fixture, so none of this needs an account, a database or production data. Answers are graded
 * by a second model and, for length and the closing question, counted mechanically.
 *
 *   node scripts/chat-eval.mjs                                  # every fixture, every question
 *   node scripts/chat-eval.mjs --fixture=omrezja-sl
 *   node scripts/chat-eval.mjs --trials=3                       # repeat, for a noisy rule
 *   node scripts/chat-eval.mjs --prompt=/tmp/main/tutor-prompt.ts   # compare against another
 *                                                                   # revision's instructions
 *
 * The last flag is how a prompt change is judged rather than admired: write the old file out
 * with `git show main:src/lib/ai/tutor-prompt.ts`, run both, and compare the columns.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { chatAnswerSchema } from "../src/lib/ai/schemas.ts";
import { resolveStageModelConfig } from "../src/lib/ai/model-config.ts";
import { countWords, generate, GRADER_MODEL, ledger, loadEnv } from "./lib/eval-runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "evals", "fixtures");

loadEnv(ROOT);

const args = process.argv.slice(2);
const flag = (name, fallback) =>
  args.find((entry) => entry.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const only = flag("fixture", null);
const trials = Number.parseInt(flag("trials", "1"), 10);
const promptModule = flag("prompt", null);
const modelOverride = flag("model", null);

const { buildTutorInstructions } = await import(
  promptModule ? path.resolve(promptModule) : "../src/lib/ai/tutor-prompt.ts"
);

/*
 * The learner the fixtures are answered for. A real request carries this block when the
 * onboarding survey was filled in, so the eval carries it too — an answer pitched at a
 * second-year university student is the answer production will produce.
 */
const LEARNER = { name: "Nina", level: "a university student, year 2", subject: "engineering and technology" };

/*
 * What gets asked. Each question is a shape the chat has to handle rather than a topic:
 * a list, a confusion, an off-material aside, a thank-you, and a question in a language the
 * material is not in. `expect` is what the grader is told to check beyond the shared rules.
 */
const QUESTIONS = {
  sl: [
    { id: "list", text: "Katere so plasti modela OSI?", expect: "names the OSI layers" },
    {
      id: "confusion",
      text: "Ne razumem razlike med MAC in IP naslovom, razloži mi preprosto.",
      expect: "separates the two kinds of address and says what each is for",
    },
    {
      id: "why",
      text: "Zakaj sploh potrebujemo toliko plasti?",
      expect: "gives a reason rather than re-listing the layers",
    },
    {
      id: "off-material",
      text: "Kaj je entropija?",
      expect:
        "answers the general-knowledge question properly and does not refuse it for being outside the notes",
      offMaterial: true,
    },
    {
      id: "thanks",
      text: "Hvala, super razlaga!",
      expect: "is a short acknowledgement",
      closing: "none",
    },
    {
      id: "language-switch",
      text: "Sorry, could you explain the transport layer in English?",
      expect: "explains the transport layer",
      language: "en",
    },
  ],
  en: [
    {
      id: "list",
      text: "What are the main parts of a synapse?",
      expect: "names the presynaptic side, the cleft and the postsynaptic side",
    },
    {
      id: "confusion",
      text: "I don't get why the signal only goes one way. Can you explain simply?",
      expect: "explains the one-way direction of transmission",
    },
    {
      id: "exam",
      text: "Give me 3 exam questions on this.",
      expect: "gives exactly three exam questions",
      // Three questions is what was asked for; counting question marks says nothing here.
      closing: "any",
      // "Here are three questions:" is the half-line the prompt allows in front of a list.
      leadIn: "allowed",
    },
  ],
};

const verdictSchema = z.object({
  language: z
    .string()
    .describe("ISO 639-1 code of the language the answer is written in, e.g. sl, en, hr"),
  opensWithAnswer: z
    .boolean()
    .describe("True when the FIRST sentence answers the question, rather than introducing one"),
  preamble: z
    .string()
    .describe(
      "The opening filler if there is any — a greeting, 'great question', restating the question, " +
        "announcing what is about to be explained. Empty string when there is none.",
    ),
  accurate: z
    .boolean()
    .describe("True when every factual claim is supported by the material or by settled general knowledge"),
  inaccuracy: z.string().describe("The false or contradicted claim, or an empty string"),
  answersTheAsk: z.boolean().describe("True when the answer does the specific thing named in `expect`"),
  refused: z.boolean().describe("True when it declined to answer or sent the learner away empty-handed"),
  condescending: z.boolean().describe("True when it talks down to the learner or lectures them"),
  friendly: z.boolean().describe("True when it reads as a warm person rather than a reference entry"),
});

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf8"));
}

/*
 * The transcript chunks a real request carries. Production picks these by embedding similarity;
 * the fixtures are small enough that every chunk fits, which is the friendliest case for
 * retrieval and the hardest one for brevity — there is more material to be tempted into.
 */
function buildContext(source) {
  return source
    .split(/\n\n+/)
    .filter((paragraph) => paragraph.trim())
    .map((text, idx) => ({ idx, startMs: idx * 30_000, endMs: (idx + 1) * 30_000, text: text.trim() }));
}

/** How many sentences end in a question mark — the closing-question rule, counted. */
function countQuestions(answer) {
  return (answer.match(/\?/g) ?? []).length;
}

function endsWithQuestion(answer) {
  return /\?["»”'）)]*\s*$/.test(answer.trim());
}

async function askOnce({ fixture, question, model, thinkingLevel, providerSort }) {
  const started = Date.now();
  const answer = await generate({
    schema: chatAnswerSchema,
    instructions: buildTutorInstructions("lecture"),
    input: JSON.stringify(
      {
        question: question.text,
        conversation: [],
        learner: LEARNER,
        noteTitle: fixture.title,
        summary: null,
        keyTopics: [],
        context: buildContext(fixture.source),
      },
      null,
      2,
    ),
    model,
    thinkingLevel,
    providerSort,
    maxOutputTokens: 2_000,
  });

  return { text: answer.answer, citations: answer.citations, ms: Date.now() - started };
}

async function grade({ fixture, question, answer }) {
  return generate({
    schema: verdictSchema,
    instructions:
      "You are grading one reply from a study app's AI tutor. Judge only what is asked for, " +
      "strictly and without charity. The reply is allowed to use knowledge beyond the material " +
      "when the material does not cover the question; that is not an inaccuracy, but " +
      "contradicting the material is.",
    input: JSON.stringify(
      {
        learnerQuestion: question.text,
        expect: question.expect,
        theirMaterial: fixture.source,
        reply: answer,
      },
      null,
      2,
    ),
    model: GRADER_MODEL,
    maxOutputTokens: 1_500,
  });
}

const fixtures = (only ? [only] : ["omrezja-sl", "synapse-en"]).map(loadFixture);
const config = resolveStageModelConfig({
  stage: "chat",
  env: process.env,
  fallbackModel: process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash-lite",
});
const model = modelOverride ?? config.model;

console.log(
  `chat-eval · model ${model} · thinking ${config.thinkingLevel} · sort ${config.providerSort ?? "throughput"}` +
    `${promptModule ? ` · prompt ${promptModule}` : ""}\n`,
);

const rows = [];

for (const fixture of fixtures) {
  for (const question of QUESTIONS[fixture.language] ?? []) {
    for (let trial = 0; trial < trials; trial += 1) {
      const { text, citations, ms } = await askOnce({
        fixture,
        question,
        model,
        thinkingLevel: config.thinkingLevel,
        providerSort: config.providerSort,
      });
      const verdict = await grade({ fixture, question, answer: text });
      const expectedLanguage = question.language ?? fixture.language;

      rows.push({
        fixture: fixture.id,
        question: question.id,
        words: countWords(text),
        ms,
        citations: citations.length,
        language: verdict.language,
        languageOk: verdict.language.toLowerCase().startsWith(expectedLanguage),
        opensWithAnswer:
          question.leadIn === "allowed" || (verdict.opensWithAnswer && !verdict.preamble),
        preamble: verdict.preamble,
        accurate: verdict.accurate,
        inaccuracy: verdict.inaccuracy,
        answersTheAsk: verdict.answersTheAsk && !verdict.refused,
        questionMarks: countQuestions(text),
        closingOk:
          question.closing === "any"
            ? true
            : question.closing === "none"
              ? !endsWithQuestion(text)
              : endsWithQuestion(text) && countQuestions(text) <= 1,
        friendly: verdict.friendly && !verdict.condescending,
        text,
      });

      const row = rows.at(-1);
      console.log(
        `${row.fixture.padEnd(12)} ${row.question.padEnd(16)} ${String(row.words).padStart(4)}w ` +
          `${String(row.ms).padStart(6)}ms  ${row.languageOk ? "lang✓" : `LANG=${row.language}`} ` +
          `${row.opensWithAnswer ? "lead✓" : "LEAD✗"} ${row.accurate ? "true✓" : "TRUE✗"} ` +
          `${row.answersTheAsk ? "ask✓" : "ASK✗"} ${row.closingOk ? "q✓" : `Q=${row.questionMarks}`} ` +
          `${row.friendly ? "warm✓" : "WARM✗"}`,
      );

      if (!row.accurate && row.inaccuracy) {
        console.log(`    inaccuracy: ${row.inaccuracy}`);
      }

      if (row.preamble) {
        console.log(`    preamble: ${row.preamble}`);
      }

      // A row that failed anything is printed, because a percentage cannot be read.
      if (!row.languageOk || !row.accurate || !row.answersTheAsk || !row.closingOk) {
        console.log(`    ${row.text.replace(/\n/g, "\n    ")}`);
      }
    }
  }
}

const rate = (predicate) => rows.filter(predicate).length / rows.length;
const words = rows.map((row) => row.words).sort((a, b) => a - b);
const percentile = (p) => words[Math.min(words.length - 1, Math.floor(words.length * p))];

console.log("\n--- summary ---");
console.log(`answers            ${rows.length}`);
console.log(
  `words              p50 ${percentile(0.5)}  p90 ${percentile(0.9)}  max ${words.at(-1)}` +
    `   over 120: ${rows.filter((row) => row.words > 120).length}`,
);
console.log(`right language     ${(rate((row) => row.languageOk) * 100).toFixed(0)}%`);
console.log(`opens with answer  ${(rate((row) => row.opensWithAnswer) * 100).toFixed(0)}%`);
console.log(`accurate           ${(rate((row) => row.accurate) * 100).toFixed(0)}%`);
console.log(`did what was asked ${(rate((row) => row.answersTheAsk) * 100).toFixed(0)}%`);
console.log(`closing question   ${(rate((row) => row.closingOk) * 100).toFixed(0)}%`);
console.log(`warm, not preachy  ${(rate((row) => row.friendly) * 100).toFixed(0)}%`);
console.log(
  `cost               $${ledger.costUsd.toFixed(4)} over ${ledger.calls} calls (grading included)`,
);

if (args.includes("--print")) {
  console.log("\n--- answers ---");
  for (const row of rows) {
    console.log(`\n[${row.fixture} / ${row.question}] ${row.words} words\n${row.text}`);
  }
}
