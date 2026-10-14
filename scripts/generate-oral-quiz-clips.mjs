/*
 * Records the tutor's half of the UGC oral quiz (`/ugc/oral-quiz`),
 * once, into files the page just plays.
 *
 * Each tutor turn, in each app language, becomes an mp3 in
 * public/ugc/oral-quiz/<locale>/, and the time each of its words is spoken
 * goes into src/lib/ugc/oral-quiz-timings.json, so
 * the page highlights the word the voice is on rather than guessing at a pace. The
 * voice is Gemini's since 2026-10-14, like the tutor's in the app; Gemini reports no timings, so
 * they come from a Soniox transcription of the finished clip — the way a note's read-aloud places
 * its highlight. `TTS_PROVIDER=soniox` records with Soniox and its character timestamps instead.
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
import { geminiMp3 } from "./lib/gemini-speech.mjs";
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
/* Fresh takes of one clip before its words are declared unmatchable. */
const ALIGN_TAKES = 5;

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
 * is where it was said. More than a couple missing means the voice said something else,
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

  /*
   * Two unmatched words mid-clip, not one, since the timings come from a transcription: it spells
   * the line's English loanwords its own way ("DICK" as "DIK", "Kayexalate" as "kajeksalat") in a
   * take that says them perfectly well. Each is timed between its matched neighbours.
   */
  /* A last word nothing matched leaves its own piece behind, which is that word, not an extra. */
  const leftover = pieces.length - next - (timed[timed.length - 1] ? 0 : 1);

  if (missingHead > 4 || missing > 2 || leftover > 0) {
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

/*
 * The Gemini voice, with its words timed by transcribing the clip. Soniox's tokens are pieces of
 * words, a new word starting with a space, so they are joined back into the one-piece-per-word
 * shape `alignWords` reads.
 */
async function renderGemini(client, { text, voice, language }) {
  const { audio, durationMs } = await geminiMp3({ text, voice, language, bitrate: BITRATE, timeoutMs: TIMEOUT_MS });
  const transcription = await client.stt.transcribe({
    model: process.env.SONIOX_MODEL || "stt-async-v4",
    file: audio,
    filename: "oral-quiz.mp3",
    language_hints: [language],
    language_hints_strict: true,
    wait: true,
    cleanup: ["file", "transcription"],
  });

  if (transcription.status !== "completed") {
    throw new Error(transcription.error_message || `transcription ${transcription.status}`);
  }

  const transcript = transcription.transcript ?? (await transcription.getTranscript());
  const pieces = [];

  for (const token of transcript?.tokens ?? []) {
    if (token.is_audio_event || typeof token.start_ms !== "number" || typeof token.end_ms !== "number") {
      continue;
    }

    if (pieces.length === 0 || /^\s/.test(token.text)) {
      pieces.push({ text: token.text.trim(), start_ms: token.start_ms, end_ms: token.end_ms });
    } else {
      pieces[pieces.length - 1].text += token.text;
      pieces[pieces.length - 1].end_ms = token.end_ms;
    }
  }

  return { audio, durationMs, pieces: pieces.filter((piece) => normalize(piece.text)) };
}

async function render(client, { text, voice, language, model }) {
  let lastError;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      if (process.env.TTS_PROVIDER !== "soniox") {
        return await renderGemini(client, { text, voice, language });
      }

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
      let rendered;
      let words = null;

      /*
       * A take whose words cannot be matched back to the line is made again. Gemini voices each
       * request afresh, and the transcription that times the words can mishear an odd one (a drug
       * name, a mnemonic) in one take and not the next.
       */
      for (let take = 1; take <= ALIGN_TAKES && !words; take += 1) {
        rendered = await render(client, { text: spoken, voice, language, model });
        words = alignWords(oralQuizWords(spoken), rendered.pieces, rendered.durationMs);
      }

      if (!words) {
        throw new Error(
          `${language} clip ${turn.clip}: the voice's words do not match the line — ` +
            `"${rendered.pieces.map((piece) => piece.text).join(" ")}"`,
        );
      }

      const { audio, durationMs } = rendered;

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
