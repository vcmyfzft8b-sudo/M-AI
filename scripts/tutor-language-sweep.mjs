/**
 * Which model should say the tutor's words, and what it costs to repair the one that teaches best.
 *
 * The spoken tutor has one measured defect: GLM 5.3 Flash writes the best turns of anything
 * tried and misspells the language it writes them in, which a reader forgives and a speech
 * synthesizer does not. This script marks the ways out of that against each other on one
 * fixture, on the two numbers that decide it — how wrong the language is, and how long the
 * learner sits in silence first.
 *
 *   node --experimental-strip-types scripts/tutor-language-sweep.mjs
 *   node --experimental-strip-types scripts/tutor-language-sweep.mjs --arms=glm,glm-proof --trials=4
 *   node --experimental-strip-types scripts/tutor-language-sweep.mjs --fixture=synapse-en
 *
 * Every arm is asked the same questions off the same lesson plan, and the plan is generated
 * once and cached: a turn is only comparable to another turn about the same topic.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  buildTutorLessonPlanInstructions,
  buildTutorVoiceInstructions,
  tutorLessonPlanSchema,
  tutorTurnSchema,
} from "../src/lib/ai/tutor-voice-prompt.ts";
import {
  buildLanguageRepairInput,
  buildLanguageRepairInstructions,
  createProofreadStream,
  languageRepairSchema,
} from "../src/lib/ai/language-repair.ts";
import { JsonStringFieldScanner } from "../src/lib/ai/stream-json.ts";
import { GLM_TEXT_MODEL, LANGUAGE_CHECK_MODEL } from "../src/lib/ai/model-config.ts";
import { detectSourceLanguage } from "../src/lib/languages.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "evals", "fixtures");
const SWEEP_DIR = path.join(ROOT, "evals", "sweep");

const args = process.argv.slice(2);
const flag = (name, fallback) =>
  args.find((entry) => entry.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

const fixtureName = flag("fixture", "omrezja-sl");
const trials = Number(flag("trials", "3"));
const PROOFREAD_MODEL = flag("proofreader", LANGUAGE_CHECK_MODEL);
const JUDGE_MODEL = flag("judge", "or/google/gemini-3.7-flash");

/*
 * The candidates.
 *
 * `glm` is production. The two temperature arms exist because an invented word is what
 * high-temperature sampling looks like in a language the model has seen little of, and if
 * that is the cause then the fix is free — a decoding parameter rather than a second model.
 * `gemini` is the escape hatch: a model that has never made this mistake, at four times the
 * price and a shorter turn. `glm-proof` is GLM with the streaming repair in front of it.
 */
const ARMS = {
  glm: { writer: GLM_TEXT_MODEL },
  "glm-t03": { writer: GLM_TEXT_MODEL, temperature: 0.3 },
  "glm-t00": { writer: GLM_TEXT_MODEL, temperature: 0 },
  gemini: { writer: "or/google/gemini-2.5-flash" },
  "glm-proof": { writer: GLM_TEXT_MODEL, proofread: PROOFREAD_MODEL },
};

const armNames = flag("arms", Object.keys(ARMS).join(",")).split(",");

const fixture = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, `${fixtureName}.json`), "utf8"),
);

/* --- the wire ------------------------------------------------------------- */

async function openRouter(body, { signal } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: signal ?? AbortSignal.timeout(180_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`${body.model}: ${response.status} ${(await response.text()).slice(0, 300)}`);
      }

      return response;
    } catch (error) {
      const transient = /fetch failed|ETIMEDOUT|ECONNRESET|socket hang up|50\d/i.test(
        `${error?.message} ${error?.cause?.code ?? ""}`,
      );

      if (!transient || attempt >= 2 || signal?.aborted) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

function requestBody({ model, schema, instructions, input, maxOutputTokens, temperature, stream }) {
  const routed = model.replace(/^or\//, "");

  return {
    model: routed,
    ...(stream ? { stream: true } : {}),
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
    ...(temperature === undefined ? {} : { temperature }),
    response_format: {
      type: "json_schema",
      json_schema: { name: "structured_output", strict: true, schema: z.toJSONSchema(schema) },
    },
    // Mirrors buildReasoningBlock/buildProviderBlock in src/lib/ai/openrouter.ts: GLM cannot be
    // told not to reason, and the tutor stage is the one that sorts hosts by latency.
    ...(routed.includes("glm") ? { reasoning: { effort: "low", exclude: true } } : {}),
    provider: { sort: "latency", require_parameters: true },
  };
}

async function generate({ model, schema, instructions, input, maxOutputTokens, signal }) {
  const response = await openRouter(
    requestBody({ model, schema, instructions, input, maxOutputTokens }),
    { signal },
  );
  const payload = await response.json();
  const raw = payload.choices?.[0]?.message?.content ?? "";

  return schema.parse(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)));
}

/**
 * One streamed turn, reported the way the learner experiences it.
 *
 * `firstSpokenMs` is the number that matters and the reason this does not just time the model:
 * it is when the first word reaches the speech socket, which for a proofread arm is after the
 * repair rather than after the writer.
 */
async function streamTurn({ model, instructions, input, maxOutputTokens, temperature, onSpoken }) {
  const started = Date.now();
  const response = await openRouter(
    requestBody({
      model,
      schema: tutorTurnSchema,
      instructions,
      input,
      maxOutputTokens,
      temperature,
      stream: true,
    }),
  );

  const scanner = new JsonStringFieldScanner("speech");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  let firstTokenMs = null;

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

      const delta = payload.choices?.[0]?.delta?.content;

      if (!delta) {
        continue;
      }

      raw += delta;
      const text = scanner.push(delta);

      if (text) {
        if (firstTokenMs === null) {
          firstTokenMs = Date.now() - started;
        }

        onSpoken(text);
      }
    }
  }

  const parsed = tutorTurnSchema.parse(
    JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)),
  );

  return { parsed, firstTokenMs, writtenMs: Date.now() - started, startedAt: started };
}

/* --- the lesson plan, generated once and shared by every arm -------------- */

const planCache = path.join(SWEEP_DIR, `tutor.plan.${fixtureName}.json`);

async function loadPlan() {
  if (fs.existsSync(planCache)) {
    return JSON.parse(fs.readFileSync(planCache, "utf8"));
  }

  const plan = await generate({
    model: GLM_TEXT_MODEL,
    schema: tutorLessonPlanSchema,
    instructions: buildTutorLessonPlanInstructions(),
    input: JSON.stringify(
      {
        language: fixture.language,
        noteTitle: fixture.title,
        summary: fixture.notes,
        keyTopics: [],
        notes: fixture.source,
      },
      null,
      2,
    ),
    maxOutputTokens: 1_600,
  });

  fs.mkdirSync(SWEEP_DIR, { recursive: true });
  fs.writeFileSync(planCache, JSON.stringify(plan, null, 2));

  return plan;
}

/* --- grading -------------------------------------------------------------- */

/*
 * The judge is asked for the offending words themselves rather than for a score, because a
 * score cannot be checked and a list can: every error it reports is printed with the run, so
 * a wrong verdict is visible rather than averaged in.
 */
const gradeSchema = z.object({
  errors: z
    .array(
      z.object({
        text: z.string().describe("The exact wrong word or phrase, copied from the passage."),
        kind: z
          .enum(["nonexistent-word", "wrong-form", "agreement", "spelling", "other"])
          .describe("What is wrong with it. 'nonexistent-word' is a word that does not exist."),
        correction: z.string().describe("What it should have been."),
      }),
    )
    .describe("Every genuine language error. Empty when the passage is correct."),
  coveredPoints: z
    .array(z.number())
    .describe("The 1-based indexes of the topic points the passage actually teaches."),
  meaningChanged: z
    .boolean()
    .describe("Only meaningful when a 'before' passage is given: whether the two say different things."),
});

const judgeInstructions = (language) => [
  `You are a strict native speaker of the language coded "${language}", marking a passage written to be read out loud to a student.`,
  "",
  "Report EVERY genuine language error: words that do not exist in the language, wrong inflections, wrong agreement, misspellings, wrong diacritics.",
  "Copy each offending word exactly as it appears so it can be found in the text.",
  "",
  "Do not report: informal register, contractions, short sentences, spoken-language phrasing, foreign technical terms and proper nouns left in their own language, or stylistic choices you would have made differently. Those are all intentional. Only report things that are actually WRONG.",
  "",
  "Then say which of the numbered topic points the passage actually teaches — not merely mentions.",
  "",
  "If a 'before' passage is given as well, say whether the two passages differ in what they claim: a different fact, number, name, or a clause that appears in one and not the other. Wording changes alone are not a meaning change.",
].join("\n");

async function grade({ passage, points, before, language }) {
  return generate({
    model: JUDGE_MODEL,
    schema: gradeSchema,
    instructions: judgeInstructions(language),
    input: JSON.stringify(
      {
        topicPoints: points.map((point, index) => `${index + 1}. ${point}`),
        before: before ?? null,
        passage,
      },
      null,
      2,
    ),
    maxOutputTokens: 3_000,
  });
}

/* --- a run ---------------------------------------------------------------- */

const plan = await loadPlan();

console.log(`fixture ${fixtureName} (${fixture.language}) — ${fixture.title}`);
console.log(`plan: ${plan.topics.length} topics, ${trials} trials per arm`);
console.log(`proofreader ${PROOFREAD_MODEL} | judge ${JUDGE_MODEL}\n`);

const TOPIC_INDEX = 1;

/*
 * What the learner interrupts with — and it decides the language of the answer, not just its
 * content. The tutor's own rule is that the learner's voice outranks the material, so asking a
 * question in Slovenian about an English lecture gets a Slovenian answer. That is correct
 * behaviour and it is why the checker is told the DETECTED language below rather than the
 * fixture's: a turn checked as the wrong language is a checker asked to translate.
 */
const QUESTION = flag("ask", "Počakaj, razloži mi to kot da imam pet let.");

function turnInput(kind, { question = null } = {}) {
  return JSON.stringify(
    {
      language: fixture.language,
      noteTitle: fixture.title,
      subject: plan.subject,
      runningOrder: plan.topics.map((topic, index) => ({
        index,
        title: topic.title,
        current: index === TOPIC_INDEX,
      })),
      topic: plan.topics[TOPIC_INDEX],
      spokenSoFar: null,
      learnerJustSaid: question,
      conversation: question ? [{ role: "learner", content: question }] : [],
      notes: fixture.source,
    },
    null,
    2,
  );
}

async function runTurn(arm, kind) {
  const config = ARMS[arm];
  const input = turnInput(kind, kind === "answer" ? { question: QUESTION } : {});
  // Exactly what speakTutorTurn's resolveSpokenLanguage does, so the harness checks the language
  // production would check rather than the one the fixture happens to be filed under.
  const language =
    (kind === "answer" ? detectSourceLanguage(QUESTION) : null) ?? fixture.language;

  let spoken = "";
  let firstSpokenMs = null;
  let startedAt = Date.now();
  let stats = null;

  const emit = (text) => {
    if (firstSpokenMs === null && text.trim()) {
      firstSpokenMs = Date.now() - startedAt;
    }

    spoken += text;
  };

  const proofreader = config.proofread
    ? createProofreadStream({
        onDelta: emit,
        correct: async ({ text, preceding, signal }) => {
          const result = await generate({
            model: config.proofread,
            schema: languageRepairSchema,
            instructions: buildLanguageRepairInstructions(language, { spoken: true }),
            input: buildLanguageRepairInput({ text, preceding }),
            maxOutputTokens: 1_200,
            signal,
          });

          return result.corrected;
        },
      })
    : null;

  const { parsed, firstTokenMs, writtenMs } = await streamTurn({
    model: config.writer,
    instructions: buildTutorVoiceInstructions(kind),
    input,
    maxOutputTokens: 700,
    temperature: config.temperature,
    onSpoken: (text) => (proofreader ? proofreader.push(text) : emit(text)),
  });

  if (proofreader) {
    stats = await proofreader.flush();
  }

  const finalText = proofreader ? spoken : parsed.speech;

  return {
    arm,
    kind,
    language,
    written: parsed.speech,
    spoken: finalText,
    words: finalText.trim().split(/\s+/).length,
    firstTokenMs,
    firstSpokenMs,
    writtenMs,
    totalMs: Date.now() - startedAt,
    stats,
  };
}

const results = [];

for (const arm of armNames) {
  if (!ARMS[arm]) {
    throw new Error(`unknown arm: ${arm}`);
  }

  for (const kind of ["teach", "answer"]) {
    for (let trial = 0; trial < trials; trial += 1) {
      process.stdout.write(`  ${arm} ${kind} ${trial + 1}/${trials}… `);

      try {
        const run = await runTurn(arm, kind);
        const marked = await grade({
          passage: run.spoken,
          points: plan.topics[TOPIC_INDEX].points,
          before: run.written === run.spoken ? null : run.written,
          language: run.language,
        });

        results.push({ ...run, grade: marked });
        console.log(
          `${run.words}w, first word ${run.firstSpokenMs}ms, ${marked.errors.length} errors`,
        );
      } catch (error) {
        console.log(`FAILED — ${error.message}`);
      }
    }
  }
}

/* --- the report ----------------------------------------------------------- */

const percentile = (values, p) => {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};

console.log(`\n${"arm".padEnd(11)}${"turn".padEnd(8)}${"n".padEnd(4)}${"words".padEnd(8)}` +
  `${"first word p50".padEnd(16)}${"p90".padEnd(8)}${"written".padEnd(10)}${"err/100w".padEnd(10)}covered`);

for (const arm of armNames) {
  for (const kind of ["teach", "answer"]) {
    const rows = results.filter((row) => row.arm === arm && row.kind === kind);

    if (!rows.length) {
      continue;
    }

    const firstWord = rows.map((row) => row.firstSpokenMs).filter((value) => value != null);
    const totalWords = rows.reduce((sum, row) => sum + row.words, 0);
    const totalErrors = rows.reduce((sum, row) => sum + row.grade.errors.length, 0);
    const points = plan.topics[TOPIC_INDEX].points.length;
    const covered = rows.map((row) => row.grade.coveredPoints.length);

    console.log(
      arm.padEnd(11) +
        kind.padEnd(8) +
        String(rows.length).padEnd(4) +
        String(Math.round(totalWords / rows.length)).padEnd(8) +
        `${percentile(firstWord, 0.5)}ms`.padEnd(16) +
        `${percentile(firstWord, 0.9)}ms`.padEnd(8) +
        `${Math.round(rows.reduce((s, r) => s + r.writtenMs, 0) / rows.length)}ms`.padEnd(10) +
        ((totalErrors / totalWords) * 100).toFixed(2).padEnd(10) +
        `${covered.join(",")}/${points}`,
    );
  }
}

const meaningChanges = results.filter((row) => row.grade.meaningChanged);

if (meaningChanges.length) {
  console.log(`\nMEANING CHANGED BY THE PROOFREADER in ${meaningChanges.length} run(s):`);
  meaningChanges.forEach((row) => {
    console.log(`  [${row.arm} ${row.kind}]\n   before: ${row.written}\n   after:  ${row.spoken}`);
  });
}

console.log("\nerrors found:");
for (const arm of armNames) {
  const rows = results.filter((row) => row.arm === arm);
  const errors = rows.flatMap((row) => row.grade.errors);

  console.log(
    `  ${arm.padEnd(11)} ${
      errors.length
        ? errors.map((error) => `${error.text}→${error.correction}`).join(", ")
        : "none"
    }`,
  );
}

const proofRows = results.filter((row) => row.stats);

if (proofRows.length) {
  const totals = proofRows.reduce(
    (sum, row) => {
      Object.entries(row.stats.outcomes).forEach(([key, value]) => {
        sum[key] = (sum[key] ?? 0) + value;
      });
      sum.units += row.stats.units;

      return sum;
    },
    { units: 0 },
  );
  const firstWaits = proofRows.map((row) => row.stats.firstUnitWaitMs).filter((v) => v != null);

  console.log(
    `\nproofreader: ${totals.units} units — ` +
      Object.entries(totals)
        .filter(([key]) => key !== "units")
        .map(([key, value]) => `${value} ${key}`)
        .join(", ") +
      ` | first-unit wait p50 ${percentile(firstWaits, 0.5)}ms p90 ${percentile(firstWaits, 0.9)}ms`,
  );
}

fs.mkdirSync(SWEEP_DIR, { recursive: true });
const out = path.join(SWEEP_DIR, `tutor.language.${fixtureName}.json`);
fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`\nfull transcripts in ${path.relative(ROOT, out)}`);
