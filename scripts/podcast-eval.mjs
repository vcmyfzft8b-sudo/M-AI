/**
 * Offline rehearsal of the generated podcast.
 *
 * Runs the real prompt, the real model call and the real speech socket over a committed
 * fixture, so the two things that decide whether an episode is worth listening to can be
 * judged before anybody presses play:
 *
 *   1. Does it actually teach the material? The failure here is not invention, it is
 *      evaporation — two hosts agreeing warmly for ten minutes about how important the topic
 *      is, carrying not one fact from the source. So every turn is graded against the
 *      fixture's own answer key.
 *   2. Is what they say speakable? A turn with a bullet, an asterisk or a LaTeX fragment is
 *      read out as noise, and that is invisible in a text log.
 *
 * No production data and no database: the fixture is a committed source, and the audio is
 * written to evals/output/podcast/ in the same MP3 the product serves.
 *
 *   node scripts/podcast-eval.mjs                                # deep dive, standard length
 *   node scripts/podcast-eval.mjs --format=debate --length=brief
 *   node scripts/podcast-eval.mjs --fixture=synapse-en --speak=4  # synthesize four turns
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  buildPodcastScriptInstructions,
  podcastScriptSchema,
} from "../src/lib/ai/podcast-prompt.ts";
import { normalizePodcastTurns } from "../src/lib/podcast-script.ts";
import {
  DEFAULT_PODCAST_VOICES,
  getPodcastFormat,
  voiceGender,
  getPodcastLength,
  PODCAST_MAX_TURN_WORDS,
  PODCAST_MIN_TURN_WORDS,
} from "../src/lib/podcast-settings.ts";
import { resolveStageModelConfig } from "../src/lib/ai/model-config.ts";

const { default: WebSocket } = await import("ws");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "evals", "fixtures");
const OUTPUT_DIR = path.join(ROOT, "evals", "output", "podcast");

const args = process.argv.slice(2);
const flag = (name, fallback) =>
  args.find((entry) => entry.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const fixtureName = flag("fixture", "omrezja-sl");
const formatId = flag("format", "deep_dive");
const lengthId = flag("length", "standard");
/** How many turns to actually synthesize. The script is free; the audio is not. */
const speakCount = Number.parseInt(flag("speak", "3"), 10);
const voices = {
  a: flag("voiceA", DEFAULT_PODCAST_VOICES.a),
  b: flag("voiceB", DEFAULT_PODCAST_VOICES.b),
};

/* Same loader the other harnesses use: these run outside Next, which reads .env.local for them. */
for (const file of [".env.local", ".env"]) {
  const filePath = path.join(ROOT, file);

  if (!fs.existsSync(filePath)) {
    continue;
  }

  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const separator = line.indexOf("=");

    if (line.startsWith("#") || separator < 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();

    if (!process.env[key]) {
      process.env[key] = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
}

function loadFixture(name) {
  const file = path.join(FIXTURE_DIR, `${name}.json`);

  if (!fs.existsSync(file)) {
    throw new Error(`No fixture at ${file}`);
  }

  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * The same structured call the route makes, reduced to what a script needs.
 *
 * Deliberately not imported from src/lib/ai/json.ts: that module is `server-only` and reaches
 * for Supabase to log usage. What is being measured here is the wire, and the wire is this.
 */
async function generate({ schema, instructions, input, model, maxOutputTokens }) {
  const responseSchema = z.toJSONSchema(schema);
  const routedModel = model.replace(/^or\//, "");
  const started = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(280_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: routedModel,
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
      provider: { sort: "throughput", require_parameters: true },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter ${routedModel}: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const raw = payload.choices?.[0]?.message?.content ?? "";
  const parsed = schema.parse(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)));

  return { parsed, usage: payload.usage, totalMs: Date.now() - started };
}

async function temporaryKey(usage) {
  const response = await fetch("https://api.soniox.com/v1/auth/temporary-api-key", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SONIOX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ usage_type: usage, expires_in_seconds: 900 }),
  });

  if (!response.ok) {
    throw new Error(`temporary key (${usage}): ${response.status} ${await response.text()}`);
  }

  return (await response.json()).api_key;
}

/**
 * One turn through the synthesizer, in the format the product actually serves.
 *
 * MP3 at 64kbps rather than the tutor harness's PCM, because the point here is a file the
 * player can be handed unchanged — and because the duration the player is charged for is the
 * one the byte count implies.
 */
function speakTurn({ apiKey, text, language, voice }) {
  const BITRATE = 64_000;

  return new Promise((resolve, reject) => {
    const socket = new WebSocket("wss://tts-rt.soniox.com/tts-websocket");
    const chunks = [];
    let started = Date.now();
    let firstAudioMs = null;

    socket.on("open", () => {
      started = Date.now();
      socket.send(
        JSON.stringify({
          api_key: apiKey,
          model: process.env.SONIOX_TTS_MODEL || "tts-rt-v2",
          language,
          voice,
          audio_format: "mp3",
          bitrate: BITRATE,
          return_timestamps: true,
          stream_id: "podcast-eval",
        }),
      );
      socket.send(JSON.stringify({ text, text_end: true, stream_id: "podcast-eval" }));
    });

    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());

      if (message.error_code) {
        reject(new Error(`${message.error_code}: ${message.error_message}`));
        socket.close();
        return;
      }

      if (message.audio) {
        firstAudioMs ??= Date.now() - started;
        chunks.push(Buffer.from(message.audio, "base64"));
      }

      if (message.terminated) {
        socket.close();

        const mp3 = Buffer.concat(chunks);

        resolve({
          mp3,
          firstAudioMs,
          seconds: (mp3.length * 8) / BITRATE,
          totalMs: Date.now() - started,
        });
      }
    });

    socket.on("error", reject);
  });
}

/*
 * Everything a synthesizer cannot say — the same list the tutor harness checks, for the same
 * reason: each is either silent or read out as punctuation, and neither shows up in a text log.
 */
const UNSPEAKABLE = [
  { name: "bullet or list marker", pattern: /(^|\n)\s*([-*•]|\d+[.)])\s+/ },
  { name: "markdown heading", pattern: /(^|\n)#{1,6}\s/ },
  { name: "bold or italic markers", pattern: /\*\*|__|(?<!\w)\*(?!\s)/ },
  { name: "LaTeX", pattern: /\\[a-zA-Z]+|\$[^$]+\$/ },
  { name: "code fence or backtick", pattern: /`/ },
  { name: "speaker label", pattern: /(^|\n)\s*(host\s*)?[AB]\s*:/ },
  { name: "emoji", pattern: /\p{Extended_Pictographic}/u },
];

const countWords = (value) => value.trim().split(/\s+/u).filter(Boolean).length;

const fixture = loadFixture(fixtureName);
const format = getPodcastFormat(formatId);
const length = getPodcastLength(lengthId);
const config = resolveStageModelConfig({
  stage: "podcast_script",
  env: process.env,
  fallbackModel: process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash-lite",
});

console.log(`fixture ${fixtureName} (${fixture.language}) — ${fixture.title}`);
console.log(`show "${format.id}" at "${length.id}" (~${length.targetWords} words) on ${config.model}`);
console.log(
  `voices: A=${voices.a} (${voiceGender(voices.a)})${
    format.speakerCount === 2 ? `, B=${voices.b} (${voiceGender(voices.b)})` : ""
  }\n`,
);


const { parsed: script, usage, totalMs } = await generate({
  schema: podcastScriptSchema,
  model: config.model,
  instructions: buildPodcastScriptInstructions({
    format: format.id,
    speakerCount: format.speakerCount,
    targetWords: length.targetWords,
    genders: {
      a: voiceGender(voices.a),
      ...(format.speakerCount === 2 ? { b: voiceGender(voices.b) } : {}),
    },
  }),
  input: JSON.stringify({
    language: fixture.language,
    title: fixture.title,
    summary: fixture.notes,
    keyTopics: [],
    material: fixture.source,
  }),
  maxOutputTokens: Math.round(length.targetWords * 3 * 2.5),
});

const turns = normalizePodcastTurns({ turns: script.turns, speakerCount: format.speakerCount });
const transcript = turns.map((turn) => turn.text).join("\n");
const totalWords = countWords(transcript);

console.log(`SCRIPT  ${(totalMs / 1000).toFixed(1)}s — "${script.title}"`);
console.log(
  `   ${script.turns.length} turns written, ${turns.length} after normalising; ${totalWords} words (asked for ~${length.targetWords})`,
);
console.log(
  `   tokens: ${usage?.prompt_tokens ?? "?"} in, ${usage?.completion_tokens ?? "?"} out\n`,
);

/* --- is it speakable? ---------------------------------------------------- */

const unspeakable = UNSPEAKABLE.filter((rule) => rule.pattern.test(transcript)).map((r) => r.name);

console.log(`SPEAKABLE  ${unspeakable.length === 0 ? "clean" : `FAILED — ${unspeakable.join(", ")}`}`);

/* --- is it shaped like a conversation? ----------------------------------- */

const shortest = Math.min(...turns.map((turn) => countWords(turn.text)));
const longest = Math.max(...turns.map((turn) => countWords(turn.text)));
let alternationBreaks = 0;

for (let index = 1; index < turns.length; index += 1) {
  if (turns[index].speaker === turns[index - 1].speaker) {
    alternationBreaks += 1;
  }
}

const speakerShare = turns.filter((turn) => turn.speaker === "a").length / turns.length;

console.log(
  `SHAPE      turns ${shortest}-${longest} words (floor ${PODCAST_MIN_TURN_WORDS}, ceiling ${PODCAST_MAX_TURN_WORDS})`,
);
console.log(
  `           ${alternationBreaks} same-speaker runs after normalising; host A holds ${Math.round(speakerShare * 100)}% of turns`,
);
console.log(
  `           estimated ${Math.round(totalWords / 1.7 / 60)} min of audio at the measured rate\n`,
);

/* --- does it teach the material? ----------------------------------------- */

if (Array.isArray(fixture.keyFacts) && fixture.keyFacts.length > 0) {
  const { parsed: grade } = await generate({
    schema: z.object({
      covered: z
        .array(z.number())
        .describe("The 1-based numbers of the facts the transcript actually states."),
      invented: z
        .array(z.string())
        .describe("Claims the transcript makes that the SOURCE MATERIAL does not support."),
    }),
    /*
     * Two questions, deliberately marked against two different things.
     *
     * Recall is marked against the answer key, which is the short list of what the episode had to
     * teach. Invention must NOT be: the answer key is a subset of the material, so marking against
     * it flags every true sentence the episode drew from the rest of the source. That is not a
     * hypothetical — it flagged the episode for mentioning the chapter's own end-of-chapter
     * exercises, which the source states in as many words. A harness that cries wolf about
     * invention is worse than no check, because invention is the one failure nobody can hear.
     */
    instructions: [
      "You are marking a podcast transcript that was made from the source material below.",
      "First: which of the numbered answer-key facts does the transcript actually state? A fact counts only if the transcript states it, not if it merely mentions the topic. Paraphrase is fine.",
      "Second: what does the transcript assert that the SOURCE MATERIAL does not support? Judge this against the source, never against the answer key — the answer key is only a summary of it, and material drawn from the rest of the source is correct, not invented.",
      "Count as unsupported: invented numbers, names, dates or studies; and claims strengthened past what the source says, such as calling something the only, the most important, or always true when the source does not.",
      "Do not flag ordinary explanatory framing, analogies, or a host restating what the other just said.",
    ].join("\n"),
    input: JSON.stringify({
      answerKey: fixture.keyFacts.map((fact, index) => `${index + 1}. ${fact}`),
      sourceMaterial: fixture.source,
      transcript,
    }),
    model: "or/google/gemini-3.5-flash-lite",
    maxOutputTokens: 2_000,
  });

  const covered = new Set(grade.covered.filter((n) => n >= 1 && n <= fixture.keyFacts.length));

  console.log(
    `RECALL     ${covered.size}/${fixture.keyFacts.length} facts from the fixture's own answer key`,
  );

  const missed = fixture.keyFacts.filter((_fact, index) => !covered.has(index + 1));

  for (const fact of missed.slice(0, 5)) {
    console.log(`   missed: ${fact}`);
  }

  console.log(
    `           ${grade.invented.length === 0 ? "nothing unsupported by the source" : `UNSUPPORTED — ${grade.invented.join("; ")}`}\n`,
  );
}

/* --- does each host speak of themselves in their own gender? -------------- */

/*
 * Slovenian and its neighbours agree l-participles with the gender of whoever they are about, so
 * "sem razmišljal" from a woman is wrong — and wrong in a way a listener catches instantly,
 * because they can hear which voice is speaking.
 *
 * This reports rather than asserts, because a run that happens to contain no gendered form is not
 * a failure: an expository episode can go a whole five minutes without one. What it must never do
 * is contain one that disagrees.
 */
const SELF_PAST = /\b(?:sem|nisem)\s+(?:[a-zšžčćđ]+\s+){0,2}([a-zšžčćđ]+?(la|l))\b/giu;
const OTHER_PAST = /\b(?:si|nisi)\s+(?:[a-zšžčćđ]+\s+){0,2}([a-zšžčćđ]+?(la|l))\b/giu;

const castGender = { a: voiceGender(voices.a), b: voiceGender(voices.b) };
const other = (speaker) => (speaker === "a" ? "b" : "a");
const disagreements = [];
let genderedForms = 0;

for (const turn of turns) {
  for (const [pattern, about] of [[SELF_PAST, "self"], [OTHER_PAST, "other"]]) {
    const re = new RegExp(pattern.source, "giu");
    let match;

    while ((match = re.exec(turn.text))) {
      genderedForms += 1;

      const spoken = match[2].toLowerCase() === "la" ? "f" : "m";
      const expected =
        about === "self" ? castGender[turn.speaker] : castGender[other(turn.speaker)];

      if (format.speakerCount === 2 && spoken !== expected) {
        disagreements.push(`${turn.speaker.toUpperCase()} about ${about}: "${match[0]}" reads ${spoken}, cast says ${expected}`);
      }
    }
  }
}

console.log(
  `GENDER     ${genderedForms} gender-marked form(s) in this run${
    genderedForms === 0 ? " — nothing to check" : ""
  }`,
);

for (const problem of disagreements) {
  console.log(`   DISAGREES — ${problem}`);
}

if (genderedForms > 0 && disagreements.length === 0) {
  console.log("           every one agrees with the cast");
}

console.log();

/* --- say it out loud ------------------------------------------------------ */

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(
  path.join(OUTPUT_DIR, "script.json"),
  JSON.stringify({ title: script.title, format: format.id, length: length.id, language: fixture.language, voices, turns }, null, 2),
);

const apiKey = await temporaryKey("tts_rt");
const spoken = Math.min(speakCount, turns.length);

console.log(`SPEAKING   ${spoken} of ${turns.length} turns`);

let audioSeconds = 0;

for (let index = 0; index < spoken; index += 1) {
  const turn = turns[index];
  const voice = voices[turn.speaker];
  const result = await speakTurn({
    apiKey,
    text: turn.text,
    language: fixture.language,
    voice,
  });

  audioSeconds += result.seconds;
  fs.writeFileSync(path.join(OUTPUT_DIR, `${String(index).padStart(4, "0")}.mp3`), result.mp3);
  console.log(
    `   ${index} ${voice.padEnd(8)} ${countWords(turn.text)}w → ${result.seconds.toFixed(1)}s audio, first frame ${result.firstAudioMs}ms, synthesized in ${(result.totalMs / 1000).toFixed(1)}s`,
  );
}

console.log(
  spoken === 0
    ? "\nno audio requested (--speak=0)"
    : `\n${audioSeconds.toFixed(1)}s of audio written to evals/output/podcast/ (${(audioSeconds / spoken).toFixed(1)}s per turn)`,
);
console.log(`transcript title: "${script.title}"`);
