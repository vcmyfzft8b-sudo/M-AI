/**
 * Does the tutor sound like a person who is on your side?
 *
 * The register was written for GLM and the turns are written by Gemini since 2026-09-04, so the
 * instructions that produced a warm tutor are not necessarily the ones that produce one now.
 * "Friendlier" is also the easiest thing in this product to make worse while believing you made
 * it better — the failure is not coldness, it is a tutor that opens every turn with "Odlično
 * vprašanje!" and congratulates somebody for breathing.
 *
 * So warmth is marked against named behaviours rather than a feeling, and every run is marked for
 * teaching at the same time. A turn that got warmer and stopped covering its points is a
 * regression, and this is what would catch it.
 *
 *   node --experimental-strip-types scripts/tutor-warmth-eval.mjs
 *   node --experimental-strip-types scripts/tutor-warmth-eval.mjs --trials=4
 *
 * Run it, change the prompt in tutor-voice-prompt.ts, run it again.
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
const JUDGE = flag("judge", "google/gemini-3.7-flash");
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "evals/fixtures/omrezja-sl.json"), "utf8"));
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, "evals/sweep/tutor.plan.omrezja-sl.json"), "utf8"));
const TOPIC = 1;
const QUESTION = "Počakaj, razloži mi to kot da imam pet let.";

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

/*
 * Named behaviours, not a feeling. Each is something a reader can check in the text, which is
 * what makes two runs of this comparable — and the last two are the ways "friendlier" goes wrong.
 */
const markSchema = z.object({
  speaksToThem: z
    .boolean()
    .describe("Addresses the learner directly, as a person in the room, rather than narrating."),
  soundsLikeAPerson: z
    .boolean()
    .describe("Contractions, everyday words, natural rhythm — not a textbook read aloud."),
  onTheirSide: z
    .boolean()
    .describe("Something in it is for them: reassurance, an acknowledgement, a shared aside, an 'everybody gets this wrong'."),
  reactsToWhatTheySaid: z
    .boolean()
    .describe("Only for a turn answering the learner: it responds to what THEY said rather than restarting the topic. False for other kinds."),
  warmth: z
    .number()
    .describe("1 to 5. 1 is a lecture transcript, 3 is pleasant but impersonal, 5 is a friend explaining it the night before the exam."),
  gushing: z
    .boolean()
    .describe("TRUE if it flatters, congratulates unearned, or performs enthusiasm — 'odlično vprašanje', 'super!', exclamation marks. This is a failure, not warmth."),
  patronising: z
    .boolean()
    .describe("TRUE if the warmth talks down to them, over-explains that it is being kind, or sounds like a children's presenter."),
  teaches: z
    .number()
    .describe("1 to 5, independent of warmth: how well the passage does the job its OWN turn kind was given — a teaching turn is judged on the topic's points, an opening on introducing the material and teaching one thing, an answer on answering what the learner asked. A warmer turn that teaches less is a regression."),
});

const judgeInstructions = [
  "You are marking one spoken turn from a Slovenian voice tutor talking to one student.",
  "Mark what is actually in the text against each named behaviour. Be strict and literal.",
  "",
  "Warmth is not enthusiasm. A tutor that says 'odlično vprašanje' or 'super' or uses exclamation marks is GUSHING, which is a failure — mark it so even if it feels friendly.",
  "Warmth is: talking to them like a person, sounding relaxed, being on their side, admitting when something is fiddly, and being pleased in a way that is earned.",
  "",
  "Mark `teaches` separately and honestly. A turn can be delightful and teach nothing.",
  "Judge `teaches` against what THIS kind of turn is for, not against the topic's points in general: an opening greets and teaches one thing, an answer answers what was asked, only a teaching turn owes the points. Topic points are given for context and are only the standard for a teaching turn.",
].join("\n");

async function markTurn({ kind, speech }) {
  return complete({
    model: JUDGE,
    instructions: judgeInstructions,
    schema: markSchema,
    maxOutputTokens: 2_000,
    input: JSON.stringify(
      { turnKind: kind, topicPoints: plan.topics[TOPIC].points, learnerSaid: kind === "answer" ? QUESTION : null, passage: speech },
      null,
      2,
    ),
  });
}

const KINDS = ["opening", "teach", "answer"];

console.log(`writer ${writer} · judge ${JUDGE} · ${trials} trials per kind\n`);
console.log(`${"turn".padEnd(9)}${"warmth".padEnd(9)}${"teaches".padEnd(10)}${"to them".padEnd(9)}${"human".padEnd(8)}${"on side".padEnd(9)}${"reacts".padEnd(8)}${"gushing".padEnd(9)}patronising`);

const all = [];

for (const kind of KINDS) {
  const marks = [];

  for (let trial = 0; trial < trials; trial += 1) {
    try {
      const turn = await complete({
        model: writer,
        instructions: buildTutorVoiceInstructions(kind),
        input: turnInput(kind),
        schema: tutorTurnSchema,
        maxOutputTokens: 700,
      });
      const mark = await markTurn({ kind, speech: turn.speech });

      marks.push(mark);
      all.push({ kind, speech: turn.speech, ...mark });
    } catch (error) {
      console.log(`${kind} trial ${trial + 1} FAILED — ${error.message}`);
    }
  }

  if (!marks.length) {
    continue;
  }

  const share = (pick) => `${marks.filter(pick).length}/${marks.length}`;
  const mean = (pick) => (marks.reduce((sum, m) => sum + pick(m), 0) / marks.length).toFixed(1);

  console.log(
    kind.padEnd(9) +
      mean((m) => m.warmth).padEnd(9) +
      mean((m) => m.teaches).padEnd(10) +
      share((m) => m.speaksToThem).padEnd(9) +
      share((m) => m.soundsLikeAPerson).padEnd(8) +
      share((m) => m.onTheirSide).padEnd(9) +
      (kind === "answer" ? share((m) => m.reactsToWhatTheySaid) : "—").padEnd(8) +
      share((m) => m.gushing).padEnd(9) +
      share((m) => m.patronising),
  );
}

const mean = (pick) => (all.reduce((sum, row) => sum + pick(row), 0) / all.length).toFixed(2);
console.log(`\noverall  warmth ${mean((r) => r.warmth)}/5 · teaches ${mean((r) => r.teaches)}/5 · gushing ${all.filter((r) => r.gushing).length}/${all.length} · patronising ${all.filter((r) => r.patronising).length}/${all.length}`);

console.log("\nsamples:");
for (const kind of KINDS) {
  const row = all.find((entry) => entry.kind === kind);

  if (row) {
    console.log(`\n  [${kind}] warmth ${row.warmth} teaches ${row.teaches}\n  ${row.speech}`);
  }
}
