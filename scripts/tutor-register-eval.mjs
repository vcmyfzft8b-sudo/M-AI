/**
 * How far is the tutor from how somebody would actually say this out loud?
 *
 * Counting written-register constructions ("pri čemer", "od katerih") was the first attempt and
 * it measured the wrong thing: a passage can contain none of them and still be nobody's speech.
 * The product owner heard a tutor that was not talking "po domače" while that metric said it was
 * fine, and the metric was wrong.
 *
 * So this does not define the register at all. It asks a native speaker to rewrite the passage
 * the way a friend who knows the subject would actually say it — same language, same facts, same
 * technical terms — and then measures how much had to change. A passage that is already spoken
 * comes back nearly untouched. One that reads like a textbook comes back rewritten, and the
 * distance is the score.
 *
 * Self-anchoring, so it needs no rubric and works in any language.
 *
 *   node --experimental-strip-types scripts/tutor-register-eval.mjs
 *   node --experimental-strip-types scripts/tutor-register-eval.mjs --trials=4 --fixture=sieci-pl
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { buildTutorVoiceInstructions, tutorTurnSchema } from "../src/lib/ai/tutor-voice-prompt.ts";
import { resolveStageModelConfig } from "../src/lib/ai/model-config.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) =>
  args.find((entry) => entry.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

const trials = Number(flag("trials", "4"));
const fixtureName = flag("fixture", "omrezja-sl");
const JUDGE = flag("judge", "google/gemini-3.7-flash");
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, `evals/fixtures/${fixtureName}.json`), "utf8"));
const plan = JSON.parse(
  fs.readFileSync(path.join(ROOT, `evals/sweep/tutor.plan.${fixtureName}.json`), "utf8"),
);
const TOPIC = 1;
const QUESTION = flag("ask", "Počakaj, razloži mi to kot da imam pet let.");

const writer = resolveStageModelConfig({
  stage: "tutor_turn",
  env: process.env,
  fallbackModel: process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash-lite",
}).model;

async function complete({ model, instructions, input, schema, maxOutputTokens }) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(90_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: model.replace(/^or\//, ""),
      messages: [
        { role: "system", content: instructions },
        {
          role: "user",
          content: `Return exactly one JSON object that matches this JSON schema:\n${JSON.stringify(
            z.toJSONSchema(schema),
          )}\n\nSource input:\n${input}`,
        },
      ],
      max_tokens: maxOutputTokens,
      response_format: {
        type: "json_schema",
        json_schema: { name: "structured_output", strict: true, schema: z.toJSONSchema(schema) },
      },
      provider: { sort: "latency", require_parameters: true },
    }),
  });

  if (!response.ok) {
    throw new Error(`${model}: ${response.status} ${(await response.text()).slice(0, 160)}`);
  }

  const payload = await response.json();
  const raw = payload.choices?.[0]?.message?.content ?? "";

  return schema.parse(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)));
}

function turnInput(kind) {
  return JSON.stringify(
    {
      language: fixture.language,
      noteTitle: fixture.title,
      subject: plan.subject,
      runningOrder: plan.topics.map((topic, index) => ({
        index,
        title: topic.title,
        current: index === TOPIC,
      })),
      topic: kind === "opening" ? null : plan.topics[TOPIC],
      keyTopics: kind === "opening" ? [] : null,
      spokenSoFar: null,
      learnerJustSaid: kind === "answer" ? QUESTION : null,
      conversation: kind === "answer" ? [{ role: "learner", content: QUESTION }] : [],
      notes: fixture.source,
    },
    null,
    2,
  );
}

const rewriteSchema = z.object({
  spoken: z
    .string()
    .describe("The same passage as a friend would actually say it out loud, in the same language."),
  changedBecause: z
    .array(z.string())
    .describe("The handful of things that had to change, each in a few words, in English."),
});

const rewriteInstructions = [
  "You are a native speaker of the language the passage is in.",
  "Rewrite it the way a friend who happens to know the subject would ACTUALLY say it out loud to a student the night before an exam — not how a book says it, not how a teacher writes it.",
  "",
  "Keep every fact. Keep every technical term and every name exactly as written. Keep the same language. Keep roughly the same length.",
  "Change only how it is said: word choice, sentence length, word order, the small words people use out loud.",
  "Do not use dialect or slang, and do not add enthusiasm that is not there.",
  "",
  "If it already sounds like somebody talking, return it unchanged. That is a valid and common answer.",
].join("\n");

/** Word-level distance, so "how much had to change" is a number rather than an opinion. */
function changedShare(before, after) {
  const a = before.toLowerCase().match(/\p{Letter}+/gu) ?? [];
  const b = new Set(after.toLowerCase().match(/\p{Letter}+/gu) ?? []);
  const kept = a.filter((word) => b.has(word)).length;

  return a.length ? 1 - kept / a.length : 0;
}

const KINDS = ["opening", "teach", "answer"];

console.log(`writer ${writer} · judge ${JUDGE} · fixture ${fixtureName} · ${trials} trials\n`);
console.log(`${"turn".padEnd(9)}${"had to change".padEnd(16)}what a native speaker changed`);

const all = [];

for (const kind of KINDS) {
  const rows = [];

  for (let trial = 0; trial < trials; trial += 1) {
    try {
      const turn = await complete({
        model: writer,
        instructions: buildTutorVoiceInstructions(kind),
        input: turnInput(kind),
        schema: tutorTurnSchema,
        maxOutputTokens: 700,
      });
      const rewrite = await complete({
        model: JUDGE,
        instructions: rewriteInstructions,
        input: turn.speech,
        schema: rewriteSchema,
        maxOutputTokens: 2_000,
      });

      rows.push({ share: changedShare(turn.speech, rewrite.spoken), ...rewrite, original: turn.speech });
    } catch (error) {
      console.log(`  ${kind} trial ${trial + 1} FAILED — ${error.message}`);
    }
  }

  if (!rows.length) {
    continue;
  }

  all.push(...rows);
  const mean = rows.reduce((sum, row) => sum + row.share, 0) / rows.length;

  console.log(
    kind.padEnd(9) +
      `${(mean * 100).toFixed(1)}%`.padEnd(16) +
      rows.flatMap((row) => row.changedBecause).slice(0, 3).join("; "),
  );
}

const overall = all.reduce((sum, row) => sum + row.share, 0) / all.length;
console.log(`\noverall  ${(overall * 100).toFixed(1)}% of words had to change to sound spoken`);

const worst = [...all].sort((a, b) => b.share - a.share)[0];

if (worst) {
  console.log(`\nfurthest from spoken (${(worst.share * 100).toFixed(1)}%):`);
  console.log(`  written : ${worst.original}`);
  console.log(`  spoken  : ${worst.spoken}`);
}
