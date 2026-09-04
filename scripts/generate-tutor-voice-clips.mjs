/*
 * Pre-renders the tutor's voice, once, into files the app and the marketing page
 * both just play.
 *
 * Two things were being synthesized live that never needed to be. Tapping a voice
 * in the app opened a Soniox channel, waited for credentials, a socket and the
 * model, and only then made a sound — seconds after the tap, for a line that is
 * the same every time. And the landing page cannot synthesize at all: it has no
 * session and no key, so its tutor was a sphere miming.
 *
 * Both want the same thing: this voice, in this language, saying a fixed line. So
 * it is rendered here at build time and committed, and both sides become an
 * `<audio>` tag. Instant in the app, possible on the page.
 *
 * Two clips per voice per language:
 *   sample — the line the app has always previewed a voice with, kept verbatim.
 *   tutor  — a longer bed for the page's demo, which is the tutor actually
 *            explaining rather than introducing itself. Landing locales only;
 *            the app never plays it.
 *
 * Usage:  node scripts/generate-tutor-voice-clips.mjs [--voice Grace] [--language sl] [--force]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SonioxNodeClient } from "@soniox/node";

import { synthesizeTtsChunkWithTimestamps } from "../src/lib/note-tts-synthesis.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "tutor-demo");

/* Every voice the app offers, and every language a note can be written in. */
const VOICES = [
  "Grace",
  "Mina",
  "Emma",
  "Sloane",
  "Nina",
  "Daniel",
  "Adrian",
  "Freddie",
  "Bennett",
  "Evan",
  "Iris",
];

/*
 * The sample line — what a voice says when you tap it to hear it.
 *
 * Keyed by the *note's* language rather than the interface's, because that is
 * what the tutor will actually speak: previewing a voice in English and then
 * being taught in Slovenian tells you nothing about the thing you were choosing.
 * Soniox renders any of its voices in any of its languages, so the same voice is
 * worth hearing in the language it will be used in — the accent and cadence
 * differ. This is now the only copy of these lines: the app used to synthesize
 * them from a module at run time and plays the files instead.
 */
const SAMPLE = {
  sl: "Živjo, jaz sem tvoj tutor. Takole zvenim, ko ti razlagam snov.",
  en: "Hi, I'm your tutor. This is how I sound when I explain things to you.",
  hr: "Bok, ja sam tvoj tutor. Ovako zvučim dok ti objašnjavam gradivo.",
  bs: "Zdravo, ja sam tvoj tutor. Ovako zvučim dok ti objašnjavam gradivo.",
  sr: "Zdravo, ja sam tvoj tutor. Ovako zvučim dok ti objašnjavam gradivo.",
  de: "Hallo, ich bin dein Tutor. So klinge ich, wenn ich dir etwas erkläre.",
  it: "Ciao, sono il tuo tutor. Ecco come suono quando ti spiego le cose.",
};

/*
 * The page's demo. Deliberately about how the tutor works rather than about any
 * particular lecture: the page's sample note is one thing, a visitor's own notes
 * are another, and a bed that named a topic would be wrong the moment it is
 * heard anywhere else. Around twenty seconds, which is the whole walkthrough —
 * the demo pauses it when the learner cuts in and resumes where it stopped.
 */
const TUTOR = {
  sl:
    "Živjo, jaz sem tvoj tutor. Poglejva tvoje zapiske skupaj. Vzel bom eno temo naenkrat, " +
    "s preprostimi besedami, in se ustavil pri tistem, kar se najlažje zamenja. " +
    "Če ti kaj ni jasno, kar povej na glas – slišim te, ustavim se in razložim še enkrat.",
  en:
    "Hi, I'm your tutor. Let's go through your notes together. I'll take one topic at a time, " +
    "in plain words, and stop on the parts that are easy to get wrong. " +
    "If something doesn't land, just say so out loud — I'll hear you, stop, and explain it again.",
  hr:
    "Bok, ja sam tvoj tutor. Prođimo zajedno kroz tvoje bilješke. Uzet ću jednu temu po jednu, " +
    "jednostavnim riječima, i zastati ondje gdje se najlakše pogriješi. " +
    "Ako ti nešto nije jasno, samo reci naglas – čujem te, stanem i objasnim ponovno.",
  bs:
    "Zdravo, ja sam tvoj tutor. Prođimo zajedno kroz tvoje bilješke. Uzeću jednu temu po jednu, " +
    "jednostavnim riječima, i zastati ondje gdje se najlakše pogriješi. " +
    "Ako ti nešto nije jasno, samo reci naglas – čujem te, stanem i objasnim ponovo.",
  sr:
    "Zdravo, ja sam tvoj tutor. Prođimo zajedno kroz tvoje beleške. Uzeću jednu temu po jednu, " +
    "jednostavnim rečima, i zastati tamo gde se najlakše pogreši. " +
    "Ako ti nešto nije jasno, samo reci naglas – čujem te, stanem i objasnim ponovo.",
};

/*
 * Half what the app streams a note at. These are short fixed clips shipped in the
 * bundle rather than audio generated for one listener, so the trade runs the other
 * way: 32 kbps mono is clean on speech and keeps 132 of them off the repo's weight.
 */
const BITRATE = 32_000;

/* Long enough for a slow voice on a twenty-second line, short enough to fail a hang. */
const TIMEOUT_MS = 120_000;

/* How many times a refused stream is asked for again before it is reported. */
const ATTEMPTS = 4;

/* Soniox caps concurrent TTS streams per organization, and the cap is shared with
   anything else using the account — so this stays low and retries rather than
   racing. A refusal arrives as a failed WebSocket connection, not as a 429. */
const CONCURRENCY = 2;

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

/* The app's own synthesis path, so these clips are made the way a note is read. */
async function synthesize(client, { text, voice, language, model }) {
  const { audio } = await synthesizeTtsChunkWithTimestamps({
    client,
    text,
    model,
    voice,
    language,
    audioFormat: "mp3",
    bitrate: BITRATE,
    timeoutMs: TIMEOUT_MS,
  });

  return audio;
}

async function main() {
  loadEnv();

  const apiKey = process.env.SONIOX_API_KEY;

  if (!apiKey) {
    throw new Error("SONIOX_API_KEY is not set — put it in .env.local.");
  }

  const model = process.env.SONIOX_TTS_MODEL || "tts-rt-v2";
  const client = new SonioxNodeClient({ api_key: apiKey });
  const force = process.argv.includes("--force");
  const onlyVoice = arg("voice");
  const onlyLanguage = arg("language");

  const jobs = [];

  for (const [kind, texts] of [
    ["sample", SAMPLE],
    ["tutor", TUTOR],
  ]) {
    for (const [language, text] of Object.entries(texts)) {
      if (onlyLanguage && onlyLanguage !== language) {
        continue;
      }

      for (const voice of VOICES) {
        if (onlyVoice && onlyVoice !== voice) {
          continue;
        }

        jobs.push({
          kind,
          language,
          voice,
          text,
          file: path.join(OUT_DIR, language, `${voice.toLowerCase()}-${kind}.mp3`),
        });
      }
    }
  }

  const pending = jobs.filter((job) => force || !fs.existsSync(job.file));
  console.log(`${jobs.length} clips, ${pending.length} to render at ${BITRATE / 1000} kbps.`);

  let done = 0;
  let bytes = 0;
  const failures = [];
  const queue = [...pending];

  async function worker() {
    for (;;) {
      const job = queue.shift();

      if (!job) {
        return;
      }

      let lastError;

      for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        try {
          const audio = await synthesize(client, { ...job, model });

          if (audio.length === 0) {
            throw new Error("no audio returned");
          }

          fs.mkdirSync(path.dirname(job.file), { recursive: true });
          fs.writeFileSync(job.file, audio);
          bytes += audio.length;
          done += 1;
          console.log(
            `[${done}/${pending.length}] ${job.language}/${job.voice} ${job.kind} — ${(audio.length / 1024).toFixed(0)} KB`,
          );
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          /* A refused stream frees up on its own; give the account a moment. */
          await new Promise((resolve) => setTimeout(resolve, attempt * 4_000));
        }
      }

      if (lastError) {
        failures.push({ job, error: lastError });
        console.error(
          `FAILED ${job.language}/${job.voice} ${job.kind}: ${lastError?.message ?? lastError}`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\nWrote ${done} clips, ${(bytes / 1024 / 1024).toFixed(2)} MB.`);

  if (failures.length > 0) {
    console.error(`${failures.length} failed. Re-run to retry just those.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
