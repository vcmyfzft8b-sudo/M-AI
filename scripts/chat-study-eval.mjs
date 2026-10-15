/**
 * Offline rehearsal of study sets made in the chat.
 *
 * Two things decide whether "make me flashcards" works, and neither shows in a diff:
 *
 *   1. Does the chat model notice the request, in the words learners use ("naredi mi kartice",
 *      "quiz me", "daj mi vprašanja za izpit"), and leave `studyRequest` empty for everything
 *      else, including a question *about* a card it already made?
 *   2. Is the set it then writes any good: the right count, the learner's language, one idea per
 *      card, four distinct options with the right one marked?
 *
 * Runs the real tutor prompt, the real answer schema, the real set prompts and the real parser
 * against a committed fixture, on the models production's stages resolve to. No account, no
 * database.
 *
 *   node scripts/chat-study-eval.mjs                     # every case
 *   node scripts/chat-study-eval.mjs --fixture=synapse-en
 *   node scripts/chat-study-eval.mjs --intent-only       # skip writing the sets
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chatAnswerSchema } from "../src/lib/ai/schemas.ts";
import {
  buildChatStudyInstructions,
  chatStudyOutputTokens,
  chatStudySchemaFor,
} from "../src/lib/ai/chat-study-prompt.ts";
import { buildTutorInstructions } from "../src/lib/ai/tutor-prompt.ts";
import { resolveStageModelConfig, supportsThinkingLevel } from "../src/lib/ai/model-config.ts";
import {
  countChatStudyItems,
  parseChatStudyAttachment,
  resolveChatStudyCount,
} from "../src/lib/chat-study-set.ts";
import { countWords, generate, ledger, loadEnv } from "./lib/eval-runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "evals", "fixtures");

loadEnv(ROOT);

const args = process.argv.slice(2);
const flag = (name, fallback) =>
  args.find((entry) => entry.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const only = flag("fixture", null);
const intentOnly = args.includes("--intent-only");

/* `expect` is the kind the chat should ask for, or null when it should ask for nothing. */
const CASES = {
  "omrezja-sl": [
    { text: "Naredi mi kartice iz tega zapiska.", expect: "flashcards" },
    { text: "Preveri me s kvizom o plasteh OSI.", expect: "quiz" },
    { text: "Daj mi 3 vprašanja, kakršna bi bila na izpitu.", expect: "test", count: 3 },
    { text: "Nariši miselni vzorec celega predavanja.", expect: "mindmap" },
    { text: "Kaj dela transportna plast?", expect: null },
    /* Asked in English about a Slovenian note: the reply, and so the set, follow the learner. */
    { text: "Quiz me on the OSI layers", expect: "quiz", language: "en" },
    {
      text: "Zakaj je pri drugem vprašanju pravilen odgovor B?",
      expect: null,
      conversation: [
        { role: "user", content: "Naredi mi kviz." },
        {
          role: "assistant",
          content: "Tukaj je kratek kviz o modelu OSI.",
          attachedSet:
            'quiz "Model OSI"\n1. Koliko plasti ima model OSI? (A) 5; B) 7; C) 4; D) 6; correct: B)\n2. Katera plast skrbi za usmerjanje? (A) Povezavna; B) Omrežna; C) Sejna; D) Fizična; correct: B)',
        },
      ],
    },
    {
      /* A second set after a first: the reply must not copy the first set's note into itself. */
      text: "Naredi mi še 6 kartic za ponavljanje",
      expect: "flashcards",
      count: 6,
      conversation: [
        { role: "user", content: "Preveri me s kvizom." },
        {
          role: "assistant",
          content: "Tukaj je kviz o plasteh modela OSI. Izberi odgovor.",
          attachedSet:
            'quiz "Kviz: plasti modela OSI"\n1. Koliko plasti ima model OSI? (A) 5; B) 7; C) 4; D) 6; correct: B)',
        },
      ],
    },
  ],
  "synapse-en": [
    { text: "Can you make me 10 flashcards on this?", expect: "flashcards", count: 10 },
    { text: "Quiz me!", expect: "quiz" },
    { text: "Make a mind map of synapses.", expect: "mindmap" },
    { text: "What's the synaptic cleft?", expect: null },
    { text: "Give me a practice test about photosynthesis.", expect: "test" },
  ],
};

const fixtures = fs
  .readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")))
  .filter((fixture) => CASES[fixture.id] && (!only || fixture.id === only));

function stageModel(stage) {
  const config = resolveStageModelConfig({
    stage,
    env: process.env,
    fallbackModel: process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash-lite",
  });

  return {
    model: config.model,
    thinkingLevel: supportsThinkingLevel(config.model) ? config.thinkingLevel : null,
    providerSort: config.providerSort,
  };
}

const chat = stageModel("chat");
const writer = stageModel("study_items");

console.log(`chat-study-eval · chat ${chat.model} · sets ${writer.model}\n`);

function buildContext(source) {
  return source
    .split(/\n\n+/)
    .filter((paragraph) => paragraph.trim())
    .slice(0, 6)
    .map((text, idx) => ({ idx, startMs: idx * 30_000, endMs: (idx + 1) * 30_000, text: text.trim() }));
}

function summariseSet(set) {
  switch (set.kind) {
    case "flashcards":
      return set.cards.slice(0, 3).map((card) => `      ${card.front}  →  ${card.back}`);
    case "quiz":
      return [
        ...set.questions.slice(0, 2).map(
          (question) =>
            `      ${question.prompt}  [${question.options.join(" | ")}]  ✓${question.options[question.correctIndex]}`,
        ),
        `      correct positions: ${set.questions.map((question) => "ABCD"[question.correctIndex]).join("")}`,
      ];
    case "test":
      return set.questions.slice(0, 2).map((question) => `      ${question.prompt}  →  ${question.answer}`);
    case "mindmap":
      return set.doc.branches.map(
        (branch) => `      ${branch.label}: ${branch.children.map((child) => child.label).join(", ")}`,
      );
  }
}

let failures = 0;

for (const fixture of fixtures) {
  console.log(`── ${fixture.id} (${fixture.language})`);

  for (const testCase of CASES[fixture.id]) {
    const started = Date.now();
    const answer = await generate({
      schema: chatAnswerSchema,
      instructions: buildTutorInstructions("lecture"),
      input: JSON.stringify(
        {
          question: testCase.text,
          conversation: testCase.conversation ?? [],
          noteTitle: fixture.title,
          summary: null,
          keyTopics: [],
          context: buildContext(fixture.source),
        },
        null,
        2,
      ),
      maxOutputTokens: 2_000,
      ...chat,
    });
    const request = answer.studyRequest ?? null;
    const intentOk = (request?.kind ?? null) === testCase.expect;
    const countOk = testCase.count === undefined || request?.count === testCase.count;
    const words = countWords(answer.answer);
    const endsWithQuestion = /\?["»”'）)]*\s*$/.test(answer.answer.trim());
    /* The described set travels beside a turn; a reply that writes such a note itself is a leak. */
    const leaked = /\[[^\]\n]{2,80}\]|attachedSet/.test(answer.answer);
    if (leaked) failures += 1;
    /* Talk about its own instructions: "I can't paste it into the reply", "ne morem prilepiti". */
    const meta = request !== null && /ne morem|ne moreš|can't|cannot|\bprilep|v odgovor|v sporočil|into (the|this|my) (reply|message|chat)|in (the|this|my) (reply|message)/i.test(answer.answer);
    if (meta) failures += 1;

    if (!intentOk || !countOk) failures += 1;

    console.log(
      `  ${intentOk && countOk ? "ok  " : "FAIL"} "${testCase.text}" → ${
        request ? `${request.kind} ×${request.count ?? "?"} (${request.focus})` : "no set"
      } · ${words}w${request && endsWithQuestion ? " · ends with a question" : ""}${leaked ? " · LEAKED A SET NOTE" : ""}${meta ? " · META TALK" : ""} · ${Date.now() - started}ms`,
    );
    console.log(`      reply: ${answer.answer.replace(/\s+/g, " ").slice(0, 160)}`);

    if (!request || intentOnly) continue;

    const count = resolveChatStudyCount(request.kind, request.count);
    const setStarted = Date.now();
    const raw = await generate({
      schema: chatStudySchemaFor(request.kind),
      instructions: buildChatStudyInstructions(request.kind, count),
      input: JSON.stringify(
        {
          focus: request.focus,
          learnerAsked: testCase.text,
          reply: answer.answer,
          material: { noteTitle: fixture.title, notes: fixture.source },
        },
        null,
        2,
      ),
      maxOutputTokens: chatStudyOutputTokens(request.kind, count),
      ...writer,
    });
    const shaped =
      request.kind === "mindmap"
        ? { title: raw.title, doc: { title: raw.title, language: "", branches: raw.branches } }
        : raw;
    const set = parseChatStudyAttachment({ version: 1, kind: request.kind, ...shaped });
    const made = set && !set.failed ? countChatStudyItems(set) : 0;
    const dashes = (JSON.stringify(raw).match(/[—–]/g) ?? []).length;

    if (!made) failures += 1;

    console.log(
      `      set: ${set?.failed ? "FAILED" : `"${set.title}" · ${made}${request.kind === "mindmap" ? " topics" : `/${count}`}`} · ${dashes} dashes · ${Date.now() - setStarted}ms`,
    );

    if (set && !set.failed) {
      for (const line of summariseSet(set)) console.log(line);
    }
  }

  console.log("");
}

console.log(
  `${failures} failure(s) · ${ledger.calls} calls · ${ledger.inputTokens} in / ${ledger.outputTokens} out · $${ledger.costUsd.toFixed(4)}`,
);
process.exitCode = failures ? 1 : 0;
