/**
 * Is each kind of spoken turn the right shape, and does the topic actually get taught?
 *
 * The language sweep marks what a turn says; this marks how much of it there is and whether the
 * material lands. Both turned out to matter when the tutor's writer changed on 2026-09-04:
 * gemini-3.5-flash-lite writes turns that are correct, complete and too short, where the GLM it
 * replaced wrote turns that were long and ran past every ceiling. Neither shows up in a language
 * grade, and one of them was silently costing the walkthrough a point per interrupted topic.
 *
 *   node --experimental-strip-types scripts/tutor-turn-shape.mjs
 *
 * Word counts are the cheap proxy. The section at the end is the real question: a resume hands
 * back to a teach turn on the same topic, so the pair is scored together against the points the
 * interruption left unfinished.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { buildTutorVoiceInstructions, tutorTurnSchema } from "../src/lib/ai/tutor-voice-prompt.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(fs.readFileSync(`${ROOT}/evals/fixtures/omrezja-sl.json`, "utf8"));
const plan = JSON.parse(fs.readFileSync(`${ROOT}/evals/sweep/tutor.plan.omrezja-sl.json`, "utf8"));
const TOPIC = 1;
const QUESTION = "Počakaj, razloži mi to kot da imam pet let.";
// What the tutor had already said, so `resume` has something to continue from.
const SPOKEN = "Model OSI razdeli komunikacijo na sedem plasti. Začnimo pri fizični plasti, ki pošilja signale po kablu.";

// The bands the prompt actually asks for, per turn kind.
/*
 * The bands the prompt asks for, per turn kind. `resume` is the odd one: since 2026-09-04 it is a
 * bridge rather than a whole turn — a teach turn on the same topic follows it — so it is scored
 * against what a bridge should be, not against the length it used to be asked for.
 */
const TARGET = { opening: [80, 120], teach: [120, 180], answer: [60, 110], resume: [30, 80] };

async function turn(model, kind, spokenOverride) {
  const input = JSON.stringify({
    language: fixture.language, noteTitle: fixture.title, subject: plan.subject,
    runningOrder: plan.topics.map((t, i) => ({ index: i, title: t.title, current: i === TOPIC })),
    topic: kind === "opening" ? null : plan.topics[TOPIC],
    keyTopics: kind === "opening" ? [] : null,
    /*
     * Only a resume has been said something before it — a fresh teach turn opens its topic with
     * nothing behind it, and handing it `spokenSoFar` measures the handover rather than the turn.
     * `spokenOverride` is how the handover section asks for that case deliberately.
     */
    spokenSoFar: spokenOverride ?? (kind === "resume" ? SPOKEN : null),
    learnerJustSaid: kind === "answer" ? QUESTION : null,
    conversation: kind === "answer" ? [{ role: "learner", content: QUESTION }] : [],
    notes: fixture.source,
  }, null, 2);

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(120000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    body: JSON.stringify({
      model: model.replace(/^or\//, ""),
      messages: [{ role: "system", content: buildTutorVoiceInstructions(kind) },
                 { role: "user", content: `Return exactly one JSON object that matches this JSON schema:\n${JSON.stringify(z.toJSONSchema(tutorTurnSchema))}\n\nSource input:\n${input}` }],
      max_tokens: model.includes("glm") ? 1400 : 700,
      response_format: { type: "json_schema", json_schema: { name: "structured_output", strict: true, schema: z.toJSONSchema(tutorTurnSchema) } },
      ...(model.includes("glm") ? { reasoning: { effort: "low", exclude: true } } : {}),
      provider: { sort: "latency", require_parameters: true },
    }),
  });
  const p = await r.json();
  const raw = p.choices?.[0]?.message?.content ?? "";
  const parsed = tutorTurnSchema.parse(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)));
  return parsed.speech;
}

async function turnText(model, kind) {
  return turn(model, kind);
}

const coverageSchema = z.object({
  covered: z.array(z.number()).describe("1-based indexes of the topic points this passage teaches."),
});

async function judge(speech) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(90000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-3.7-flash",
      messages: [
        { role: "system", content: "Say which of the numbered topic points the passage actually TEACHES — explains, not merely mentions in passing. The passage is the second half of an explanation; the first half is given as alreadySaid and does not count." },
        { role: "user", content: `Return exactly one JSON object matching:\n${JSON.stringify(z.toJSONSchema(coverageSchema))}\n\n${JSON.stringify({ topicPoints: plan.topics[TOPIC].points.map((pt, i) => `${i + 1}. ${pt}`), alreadySaid: SPOKEN, passage: speech }, null, 2)}` },
      ],
      max_tokens: 1500,
      response_format: { type: "json_schema", json_schema: { name: "structured_output", strict: true, schema: z.toJSONSchema(coverageSchema) } },
    }),
  });
  const p = await r.json();
  const raw = p.choices?.[0]?.message?.content ?? "";
  return coverageSchema.parse(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)));
}

/*
 * Words are a proxy. What matters on a resume is whether the points the interruption left
 * unfinished actually get taught before the walkthrough moves to the next topic — which it does,
 * immediately, as soon as the resume ends.
 */
async function resumeCoverage(model) {
  const speech = await turnText(model, "resume");
  const { covered } = await judge(speech);

  return { words: speech.trim().split(/\s+/).length, covered };
}

const TRIALS = 5;
console.log(`${"writer".padEnd(26)}${"kind".padEnd(9)}${"target".padEnd(10)}${"words".padEnd(22)}mean  in band`);
for (const model of ["or/google/gemini-3.5-flash-lite", "or/z-ai/glm-5.3-flash"]) {
  for (const kind of ["opening", "teach", "answer", "resume"]) {
    const counts = (await Promise.all(Array.from({ length: TRIALS }, () => turn(model, kind).then((t) => t.trim().split(/\s+/).length).catch(() => null)))).filter(Boolean);
    const [lo, hi] = TARGET[kind];
    const inBand = counts.filter((n) => n >= lo && n <= hi).length;
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    console.log(model.replace(/^or\//, "").padEnd(26) + kind.padEnd(9) + `${lo}-${hi}`.padEnd(10) +
      counts.join(",").padEnd(22) + String(Math.round(mean)).padEnd(6) + `${inBand}/${counts.length}`);
  }
}

console.log(`\nRESUME — what actually gets taught before the walkthrough moves on (${plan.topics[TOPIC].points.length} points, ${SPOKEN.split(/\s+/).length}-word head start)`);
for (const model of ["or/google/gemini-3.5-flash-lite", "or/z-ai/glm-5.3-flash"]) {
  const runs = (await Promise.all(Array.from({ length: TRIALS }, () => resumeCoverage(model).catch(() => null)))).filter(Boolean);
  const mean = (pick) => runs.reduce((a, r) => a + pick(r), 0) / runs.length;
  console.log(
    model.replace(/^or\//, "").padEnd(28) +
      `words ${runs.map((r) => r.words).join(",")}`.padEnd(28) +
      `points ${runs.map((r) => r.covered.length).join(",")}`.padEnd(22) +
      `mean ${mean((r) => r.covered.length).toFixed(1)}/${plan.topics[TOPIC].points.length}`,
  );
}


/*
 * The pattern the opening turn already uses: it does not try to finish its topic, it hands over
 * to a teach turn on the same topic which continues from `spokenSoFar`. If a resume can do the
 * same, the short resume stops being a loss and the fast writer keeps the whole tutor.
 */
console.log("\nRESUME + a following TEACH turn, scored together");
for (const model of ["or/google/gemini-3.5-flash-lite"]) {
  const runs = (await Promise.all(Array.from({ length: 5 }, async () => {
    const resumeText = await turn(model, "resume");
    const teachText = await turn(model, "teach", `${SPOKEN} ${resumeText}`);
    const { covered } = await judge(`${resumeText} ${teachText}`);

    return { words: (resumeText + " " + teachText).trim().split(/\s+/).length, covered: covered.length };
  }).map((p) => p.catch(() => null)))).filter(Boolean);

  const mean = (pick) => runs.reduce((a, r) => a + pick(r), 0) / runs.length;
  console.log(
    model.replace(/^or\//, "").padEnd(28) +
      `words ${runs.map((r) => r.words).join(",")}`.padEnd(34) +
      `points ${runs.map((r) => r.covered).join(",")}`.padEnd(22) +
      `mean ${mean((r) => r.covered).toFixed(1)}/${plan.topics[TOPIC].points.length}`,
  );
}
