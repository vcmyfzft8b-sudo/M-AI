/**
 * Where the wait before an answer actually goes — and three places it does not.
 *
 * A learner interrupting to ask something waits about 2.0s: ~900ms for the recogniser to be sure
 * they have finished, ~700ms for the model to write its first words, ~400ms for the synthesizer.
 * The middle piece looks like the soft one, and this script is what established that it is not.
 *
 * **The note is free.** An `answer` turn ships the whole note with it, up to
 * TUTOR_NOTE_CHAR_CAP's 24,000 characters, and every latency figure recorded before 2026-09-04
 * came from fixtures a fifth of that size. Measured across the real range, time to first token
 * does not care:
 *
 *   note chars   tokens in   first token
 *   none              3,050        903ms
 *   2,000             3,720        814ms
 *   6,000             5,043        767ms
 *   12,000            7,030        734ms
 *   24,000           11,028        781ms
 *
 * Prefill is not the bottleneck — the model's time to first token is fixed overhead, and the
 * largest input was faster than the smallest. Trimming the note to make answers quicker would
 * buy nothing and cost the answer its reach beyond the current topic.
 *
 * **The gateway is free too.** Same prompt, same model, five runs each: OpenRouter answered at a
 * p50 of 672ms and Google directly at 778ms. The hop everything is routed through is not costing
 * latency; it is saving some.
 *
 * **And the wait cannot be spent in advance** — see scripts/tutor-speculation-eval.mjs, which
 * measured that the transcript is not ready before the recogniser says the question is over.
 *
 * What is left is the 900ms endpoint delay, which is a product judgement rather than an
 * engineering one, and a model that starts writing sooner.
 *
 *   node --experimental-strip-types scripts/tutor-answer-latency.mjs
 *   node --experimental-strip-types scripts/tutor-answer-latency.mjs --trials=4
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

const trials = Number(flag("trials", "3"));
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "evals/fixtures/omrezja-sl.json"), "utf8"));
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, "evals/sweep/tutor.plan.omrezja-sl.json"), "utf8"));

const model = resolveStageModelConfig({
  stage: "tutor_turn",
  env: process.env,
  fallbackModel: process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash-lite",
}).model;

const TOPIC = 1;
const QUESTION = "Počakaj, razloži mi to kot da imam pet let.";

/*
 * Real prose at each size rather than padding: token counts, and therefore prefill, depend on
 * what the text actually is. The source is repeated to reach the larger sizes because no single
 * Slovenian fixture is long enough, which is fine — the model is being timed, not read.
 */
function noteOfSize(chars) {
  if (chars === 0) {
    return null;
  }

  let text = "";

  while (text.length < chars) {
    text += `${fixture.source}\n\n`;
  }

  return text.slice(0, chars);
}

const SIZES = [0, 2_000, 6_000, 12_000, 24_000];

async function answerOnce(notes) {
  const input = JSON.stringify(
    {
      language: fixture.language,
      noteTitle: fixture.title,
      subject: plan.subject,
      runningOrder: plan.topics.map((topic, index) => ({
        index,
        title: topic.title,
        current: index === TOPIC,
      })),
      topic: plan.topics[TOPIC],
      keyTopics: null,
      spokenSoFar: null,
      learnerJustSaid: QUESTION,
      conversation: [{ role: "learner", content: QUESTION }],
      notes,
    },
    null,
    2,
  );

  const started = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: model.replace(/^or\//, ""),
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: buildTutorVoiceInstructions("answer") },
        {
          role: "user",
          content: `Return exactly one JSON object that matches this JSON schema:\n${JSON.stringify(
            z.toJSONSchema(tutorTurnSchema),
          )}\n\nSource input:\n${input}`,
        },
      ],
      max_tokens: 700,
      response_format: {
        type: "json_schema",
        json_schema: { name: "structured_output", strict: true, schema: z.toJSONSchema(tutorTurnSchema) },
      },
      provider: { sort: "latency", require_parameters: true },
    }),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${(await response.text()).slice(0, 160)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  let firstTokenMs = null;
  let usage = null;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let split = buffer.indexOf("\n");

    while (split !== -1) {
      const line = buffer.slice(0, split).trim();
      buffer = buffer.slice(split + 1);
      split = buffer.indexOf("\n");

      if (!line.startsWith("data:")) {
        continue;
      }

      const data = line.slice(5).trim();

      if (data === "[DONE]") {
        continue;
      }

      let payload;

      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }

      if (payload.usage) {
        usage = payload.usage;
      }

      const delta = payload.choices?.[0]?.delta?.content;

      if (delta) {
        firstTokenMs ??= Date.now() - started;
        raw += delta;
      }
    }
  }

  const parsed = tutorTurnSchema.parse(
    JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)),
  );

  return {
    firstTokenMs,
    totalMs: Date.now() - started,
    words: parsed.speech.trim().split(/\s+/).length,
    speech: parsed.speech,
    tokensIn: usage?.prompt_tokens ?? 0,
  };
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
};

console.log(`answer turns on ${model}, ${trials} trials per size\n`);
console.log(`${"note chars".padEnd(13)}${"tokens in".padEnd(12)}${"1st token p50".padEnd(15)}${"p90".padEnd(9)}${"words".padEnd(8)}sample`);

const samples = new Map();

for (const size of SIZES) {
  const notes = noteOfSize(size);
  const runs = [];

  for (let trial = 0; trial < trials; trial += 1) {
    try {
      runs.push(await answerOnce(notes));
    } catch (error) {
      console.log(`${String(size).padEnd(13)}FAILED — ${error.message}`);
    }
  }

  if (!runs.length) {
    continue;
  }

  samples.set(size, runs[0].speech);
  const mean = (pick) => Math.round(runs.reduce((sum, row) => sum + pick(row), 0) / runs.length);

  console.log(
    String(size === 0 ? "none" : size).padEnd(13) +
      String(mean((r) => r.tokensIn)).padEnd(12) +
      `${percentile(runs.map((r) => r.firstTokenMs), 0.5)}ms`.padEnd(15) +
      `${percentile(runs.map((r) => r.firstTokenMs), 0.9)}ms`.padEnd(9) +
      String(mean((r) => r.words)).padEnd(8) +
      `${runs[0].speech.slice(0, 46)}…`,
  );
}

console.log("\nwhat the answer looked like at each size:");
for (const [size, speech] of samples) {
  console.log(`\n  ${size === 0 ? "no note" : `${size} chars`}\n  ${speech}`);
}
