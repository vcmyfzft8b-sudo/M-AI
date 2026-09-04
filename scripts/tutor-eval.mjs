/**
 * Offline rehearsal of the spoken walkthrough.
 *
 * Runs the real prompts, the real streaming call and the real speech socket over a fixed
 * fixture, so the two things that decide whether this feature works can be judged before
 * anybody plugs in a microphone:
 *
 *   1. Is what the model writes actually speakable? A turn with a bullet, an asterisk or a
 *      LaTeX fragment in it is read out as noise, and that is invisible in a text log.
 *   2. How long is the silence before the tutor starts talking? Time to first audio is the
 *      whole feel of the thing, and it is the sum of a model's first token and a
 *      synthesizer's first frame — neither of which can be measured from the other side.
 *
 * No production data and no database: the fixture is a committed note.
 *
 *   node scripts/tutor-eval.mjs                          # plan, open, teach, interrupt, resume
 *   node scripts/tutor-eval.mjs --fixture=synapse-en
 *   node scripts/tutor-eval.mjs --save                   # also write the audio to evals/output/
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
import { resolveStageModelConfig } from "../src/lib/ai/model-config.ts";

const { default: WebSocket } = await import("ws");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "evals", "fixtures");
const OUTPUT_DIR = path.join(ROOT, "evals", "output");
const SAMPLE_RATE = 24_000;

const args = process.argv.slice(2);
const flag = (name, fallback) =>
  args.find((entry) => entry.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const fixtureName = flag("fixture", "omrezja-sl");
const save = args.includes("--save");
/** Overrides the model the spoken turns are written by, for a like-for-like comparison. */
const turnModelOverride = flag("model", null);

/*
 * The question the harness interrupts with. It is the one from the brief — a learner asking
 * for the same thing again, simpler — because that is the turn most likely to come back as a
 * repeat of the last one rather than as a new explanation.
 */
const INTERRUPTION = flag("ask", "Počakaj, razloži mi to kot da imam pet let.");

function loadFixture(name) {
  const file = path.join(FIXTURE_DIR, `${name}.json`);

  if (!fs.existsSync(file)) {
    throw new Error(`No fixture at ${file}`);
  }

  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * The same streaming call the route makes, reduced to what a script needs.
 *
 * Deliberately not imported from src/lib/ai/json.ts: that module is `server-only` and reaches
 * for Supabase to log usage. What is being measured here is the wire, and the wire is this.
 */
/**
 * The gateway is reachable over the public internet, and a laptop's connection drops. A blip
 * two turns into a rehearsal should cost a retry, not the whole run.
 */
async function streamTurn(params) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await streamTurnOnce(params);
    } catch (error) {
      const transient = /fetch failed|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|socket hang up/i.test(
        `${error?.message} ${error?.cause?.code ?? ""}`,
      );

      if (!transient || attempt >= 2) {
        throw error;
      }

      console.log(`   (network blip, retrying: ${error.message})`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function streamTurnOnce({ schema, instructions, input, model, maxOutputTokens, onDelta }) {
  const responseSchema = z.toJSONSchema(schema);
  const routedModel = model.replace(/^or\//, "");
  const started = Date.now();
  let firstTokenMs = null;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(180_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: routedModel,
      stream: true,
      messages: [
        { role: "system", content: instructions },
        {
          role: "user",
          content: `Return exactly one JSON object that matches this JSON schema:\n${JSON.stringify(
            responseSchema,
          )}\n\nSource input:\n${input}`,
        },
      ],
      max_tokens: maxOutputTokens,
      response_format: {
        type: "json_schema",
        json_schema: { name: "structured_output", strict: true, schema: responseSchema },
      },
      ...(routedModel.includes("glm") ? { reasoning: { effort: "low", exclude: true } } : {}),
      // Mirrors buildProviderBlock for the tutor stage: this is the one stage that sorts hosts
      // by latency rather than throughput, and the two differ by an order of magnitude on GLM.
      provider: { sort: "latency", require_parameters: true },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter ${routedModel}: ${response.status} ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";

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

      if (delta) {
        if (firstTokenMs === null) {
          firstTokenMs = Date.now() - started;
        }

        raw += delta;
        onDelta?.(delta);
      }
    }
  }

  const jsonStart = raw.indexOf("{");
  const parsed = schema.parse(JSON.parse(raw.slice(jsonStart, raw.lastIndexOf("}") + 1)));

  return { parsed, firstTokenMs, totalMs: Date.now() - started };
}

async function temporaryKey(usage) {
  const response = await fetch("https://api.soniox.com/v1/auth/temporary-api-key", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SONIOX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ usage_type: usage, expires_in_seconds: 600 }),
  });

  if (!response.ok) {
    throw new Error(`temporary key (${usage}): ${response.status} ${await response.text()}`);
  }

  return (await response.json()).api_key;
}

/**
 * A speech socket that takes text as it arrives, exactly as the browser client does.
 *
 * `push` is called from inside the model stream, so the two run concurrently — which is the
 * only reason the first audio arrives before the model has finished writing.
 */
function openSpeech({ apiKey, language, voice }) {
  const chunks = [];
  // Measured from the first word sent, which is when the synthesizer's work actually begins.
  let started = Date.now();
  let firstAudioMs = null;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const socket = new WebSocket("wss://tts-rt.soniox.com/tts-websocket");
  let opened = false;
  const ready = new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });

  /*
   * Announced by the first word, never before it — Soniox ends a stream with a 408 if it is
   * opened and then left silent, and the model can take seconds to write its first token.
   * The browser client defers it the same way; see speak() in speech-output.ts.
   */
  const openStream = () => {
    if (opened) {
      return;
    }

    opened = true;
    started = Date.now();
    socket.send(
      JSON.stringify({
        api_key: apiKey,
        model: process.env.SONIOX_TTS_MODEL || "tts-rt-v2",
        language,
        voice,
        audio_format: "pcm_s16le",
        sample_rate: SAMPLE_RATE,
        return_timestamps: true,
        stream_id: "eval",
      }),
    );
  };

  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());

    if (message.error_code) {
      throw new Error(`${message.error_code}: ${message.error_message}`);
    }

    if (message.audio) {
      if (firstAudioMs === null) {
        firstAudioMs = Date.now() - started;
      }

      chunks.push(Buffer.from(message.audio, "base64"));
    }

    if (message.terminated) {
      socket.close();
      resolveDone();
    }
  });

  return {
    ready,
    push: (text) => {
      if (!text) {
        return;
      }

      openStream();
      socket.send(JSON.stringify({ text, text_end: false, stream_id: "eval" }));
    },
    end: () => {
      openStream();
      socket.send(JSON.stringify({ text: "", text_end: true, stream_id: "eval" }));
    },
    finished: async () => {
      await done;

      const pcm = Buffer.concat(chunks);

      return { pcm, firstAudioMs, seconds: pcm.length / 2 / SAMPLE_RATE };
    },
  };
}

function wavFile(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/*
 * Everything a synthesizer cannot say. Each of these was chosen because it is silent or
 * mangled when spoken: markdown furniture is either skipped or read as punctuation, and a
 * LaTeX fragment is spelled out letter by letter at about five characters a second.
 */
const UNSPEAKABLE = [
  { name: "bullet or list marker", pattern: /(^|\n)\s*([-*•]|\d+[.)])\s+/ },
  { name: "markdown heading", pattern: /(^|\n)#{1,6}\s/ },
  { name: "bold or italic markers", pattern: /\*\*|__|(?<!\w)\*(?!\s)/ },
  { name: "LaTeX", pattern: /\\[a-zA-Z]+|\$[^$]+\$/ },
  { name: "code fence or backtick", pattern: /`/ },
  { name: "bare equation", pattern: /[A-Za-z0-9)]\s*=\s*[A-Za-z0-9(]/ },
  { name: "emoji", pattern: /\p{Extended_Pictographic}/u },
];

function checkSpeakable(label, text) {
  const problems = UNSPEAKABLE.filter((rule) => rule.pattern.test(text)).map((rule) => rule.name);

  console.log(
    `   speakable: ${problems.length === 0 ? "clean" : `FAILED — ${problems.join(", ")}`}`,
  );

  return problems.length === 0;
}

const fixture = loadFixture(fixtureName);
// The plan has run on its own stage since 2026-09-04: it is marked on coverage rather than prose
// and is the one half of the tutor GLM is kept for, so it resolves separately from the turns.
const planConfig = resolveStageModelConfig({
  stage: "tutor_plan",
  env: process.env,
  fallbackModel: process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash-lite",
});
const turnConfig = turnModelOverride
  ? { model: turnModelOverride }
  : resolveStageModelConfig({
      stage: "tutor_turn",
      env: process.env,
      fallbackModel: process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash-lite",
    });

console.log(`fixture ${fixtureName} (${fixture.language}) — ${fixture.title}`);
console.log(`plan on ${planConfig.model}, turns on ${turnConfig.model}\n`);

const grounding = {
  language: fixture.language,
  noteTitle: fixture.title,
  summary: fixture.notes,
  keyTopics: [],
  notes: fixture.source,
};

const planStarted = Date.now();
const { parsed: plan } = await streamTurn({
  schema: tutorLessonPlanSchema,
  instructions: buildTutorLessonPlanInstructions(),
  input: JSON.stringify(grounding, null, 2),
  model: planConfig.model,
  maxOutputTokens: 1_600,
});

console.log(`PLAN  ${Date.now() - planStarted}ms — ${plan.topics.length} topics`);
console.log(`   subject: ${plan.subject}`);
plan.topics.forEach((topic, index) => console.log(`   ${index + 1}. ${topic.title}`));
console.log();

const [ttsKey] = await Promise.all([temporaryKey("tts_rt")]);
const history = [];
let spokenSoFar = "";
let allClean = true;

async function run(kind, { question = null, topicIndex = 0 } = {}) {
  const speech = openSpeech({
    apiKey: ttsKey,
    language: fixture.language,
    voice: process.env.SONIOX_TTS_VOICE || "Grace",
  });
  await speech.ready;

  let pending = "";
  const { parsed, firstTokenMs, totalMs } = await streamTurn({
    schema: tutorTurnSchema,
    instructions: buildTutorVoiceInstructions(kind),
    input: JSON.stringify(
      {
        language: fixture.language,
        noteTitle: fixture.title,
        subject: plan.subject,
        runningOrder: plan.topics.map((topic, index) => ({
          index,
          title: topic.title,
          current: index === topicIndex,
        })),
        topic: plan.topics[topicIndex],
        spokenSoFar: spokenSoFar || null,
        learnerJustSaid: question,
        conversation: history.slice(-12),
        notes: fixture.source,
      },
      null,
      2,
    ),
    model: turnConfig.model,
    maxOutputTokens: 700,
    /*
     * The scanner in the real client reads the `speech` field out of the JSON as it streams.
     * Here the raw deltas are forwarded once a whole word is in hand, which is close enough
     * to measure the same latency — the JSON envelope is a few tokens either side.
     */
    onDelta: (delta) => {
      pending += delta;
      const boundary = pending.search(/\s\S*$/u);

      if (boundary >= 0) {
        speech.push(pending.slice(0, boundary + 1));
        pending = pending.slice(boundary + 1);
      }
    },
  });

  speech.push(pending);
  speech.end();

  const audio = await speech.finished();
  const words = parsed.speech.trim().split(/\s+/).length;

  console.log(`${kind.toUpperCase().padEnd(7)} ${words} words, handBack=${parsed.handBack}`);
  console.log(
    `   first token ${firstTokenMs}ms | first audio ${audio.firstAudioMs}ms | ` +
      `written in ${totalMs}ms | ${audio.seconds.toFixed(1)}s of speech`,
  );
  console.log(`   "${parsed.speech.trim()}"`);

  if (!checkSpeakable(kind, parsed.speech)) {
    allClean = false;
  }

  console.log();

  if (kind === "teach" || kind === "resume" || kind === "opening") {
    spokenSoFar = `${spokenSoFar} ${parsed.speech}`.trim();
  }

  history.push({ role: "tutor", content: parsed.speech });

  if (save) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const file = path.join(OUTPUT_DIR, `tutor-${fixtureName}-${kind}.wav`);
    fs.writeFileSync(file, wavFile(audio.pcm));
    console.log(`   saved ${file}\n`);
  }

  return parsed;
}

await run("opening", { topicIndex: 0 });
await run("teach", { topicIndex: 1 });

console.log(`LEARNER interrupts: "${INTERRUPTION}"\n`);
history.push({ role: "learner", content: INTERRUPTION });
await run("answer", { question: INTERRUPTION, topicIndex: 1 });
await run("resume", { topicIndex: 1 });

console.log(allClean ? "every turn was speakable." : "SOME TURNS WERE NOT SPEAKABLE.");
