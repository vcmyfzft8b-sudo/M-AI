/*
 * Records the tutor's half of the UGC oral quiz (`/ugc/oral-quiz`),
 * once, into files the page just plays.
 *
 * Each tutor turn, in each app language, becomes an mp3 in
 * public/ugc/oral-quiz/<locale>/, and the time each of its words is spoken
 * goes into src/lib/ugc/oral-quiz-timings.json, so
 * the page highlights the word the voice is on rather than guessing at a pace. The
 * timings are Soniox's own character timestamps, the same ones a note's read-aloud
 * highlights from (note-tts-synthesis.ts).
 *
 * Re-run after changing a tutor line in src/lib/ugc/oral-quiz.ts.
 *
 * Usage:  node --experimental-strip-types scripts/generate-oral-quiz-clips.mjs [--voice Grace] [--language sl]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SonioxNodeClient } from "@soniox/node";

import { synthesizeTtsChunkWithTimestamps } from "../src/lib/note-tts-synthesis.ts";
import {
  ORAL_QUIZ_SCRIPTS,
  ORAL_QUIZ_VOICE,
  oralQuizSpoken,
  oralQuizWords,
} from "../src/lib/ugc/oral-quiz.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "ugc", "oral-quiz");
const TIMINGS_FILE = path.join(ROOT, "src", "lib", "ugc", "oral-quiz-timings.json");

/* Higher than the tutor clips' 32 kbps: this one is heard through a phone filming a laptop. */
const BITRATE = 64_000;
const TIMEOUT_MS = 120_000;
const ATTEMPTS = 4;

function loadEnv() {
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
      const value = line.slice(separator + 1).trim();

      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

/* The voice starts a beat into the file (measured ~90 ms on the first clip). */
const LEAD_IN_MS = 90;

const normalize = (word) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/*
 * Pairs each printed word with the spoken piece that says it.
 *
 * Normally that is one piece per word, in order. The exception is the first few
 * words of a clip: the timestamps of the stream's opening audio go missing (measured:
 * "You just have to give her…" came back from "have"), although the words are in the
 * recording. A word with no piece is given the stretch between its neighbours, which
 * is where it was said. Anything more missing means the voice said something else,
 * and that is refused rather than committed with the highlight drifting off the words.
 */
function alignWords(printed, pieces, durationMs) {
  const timed = new Array(printed.length).fill(null);
  let next = 0;
  let missingHead = 0;
  let missing = 0;

  printed.forEach((word, index) => {
    const at = pieces.findIndex((piece, j) => j >= next && j < next + 3 && normalize(piece.text) === normalize(word));

    if (at < 0) {
      if (next === 0) {
        missingHead += 1;
      } else {
        missing += 1;
      }

      return;
    }

    timed[index] = [Math.round(pieces[at].start_ms), Math.round(pieces[at].end_ms)];
    next = at + 1;
  });

  if (missingHead > 4 || missing > 1 || next < pieces.length) {
    return null;
  }

  for (let index = 0; index < timed.length; index += 1) {
    if (timed[index]) {
      continue;
    }

    let end = index;

    while (end < timed.length && !timed[end]) {
      end += 1;
    }

    /* Shared out by length: "Remember," takes longer to say than "to". */
    const from = index === 0 ? LEAD_IN_MS : timed[index - 1][1];
    const to = end < timed.length ? timed[end][0] : Math.round(durationMs);
    const lengths = printed.slice(index, end).map((word) => normalize(word).length + 1);
    const total = lengths.reduce((sum, length) => sum + length, 0);
    let at = from;

    for (let k = index; k < end; k += 1) {
      const span = ((to - from) * lengths[k - index]) / total;
      timed[k] = [Math.round(at), Math.round(at + span)];
      at += span;
    }
  }

  return timed;
}

async function render(client, { text, voice, language, model }) {
  let lastError;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await synthesizeTtsChunkWithTimestamps({
        client,
        text,
        model,
        voice,
        language,
        audioFormat: "mp3",
        bitrate: BITRATE,
        timeoutMs: TIMEOUT_MS,
      });
    } catch (error) {
      lastError = error;
      /* A refused stream frees up on its own; give the account a moment. */
      await new Promise((resolve) => setTimeout(resolve, attempt * 4_000));
    }
  }

  throw lastError;
}

async function main() {
  loadEnv();

  const apiKey = process.env.SONIOX_API_KEY;

  if (!apiKey) {
    throw new Error("SONIOX_API_KEY is not set — put it in .env.local.");
  }

  const model = process.env.SONIOX_TTS_MODEL || "tts-rt-v2";
  const voice = arg("voice") ?? ORAL_QUIZ_VOICE;
  const onlyLanguage = arg("language");
  const client = new SonioxNodeClient({ api_key: apiKey });

  /* Re-rendering one language keeps the others' timings. */
  const timings = fs.existsSync(TIMINGS_FILE)
    ? JSON.parse(fs.readFileSync(TIMINGS_FILE, "utf8"))
    : { voice, scripts: {} };

  if (timings.voice !== voice) {
    timings.voice = voice;
    timings.scripts = {};
  }

  for (const [language, script] of Object.entries(ORAL_QUIZ_SCRIPTS)) {
    if (onlyLanguage && onlyLanguage !== language) {
      continue;
    }

    const clips = {};
    fs.mkdirSync(path.join(OUT_DIR, language), { recursive: true });

    for (const turn of script.turns) {
      if (turn.speaker !== "tutor") {
        continue;
      }

      const spoken = oralQuizSpoken(language, turn.text);
      const { audio, pieces, durationMs } = await render(client, { text: spoken, voice, language, model });
      const words = alignWords(oralQuizWords(spoken), pieces, durationMs);

      if (!words) {
        throw new Error(
          `${language} clip ${turn.clip}: the voice's words do not match the line — ` +
            `"${pieces.map((piece) => piece.text).join(" ")}"`,
        );
      }

      const file = path.join(OUT_DIR, language, `${voice.toLowerCase()}-${turn.clip}.mp3`);
      fs.writeFileSync(file, audio);
      clips[turn.clip] = { durationMs: Math.round(durationMs), words };
      console.log(`${path.relative(ROOT, file)} — ${(audio.length / 1024).toFixed(0)} KB, ${(durationMs / 1000).toFixed(1)} s`);
    }

    timings.scripts[language] = clips;
  }

  fs.writeFileSync(TIMINGS_FILE, `${JSON.stringify(timings, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, TIMINGS_FILE)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
