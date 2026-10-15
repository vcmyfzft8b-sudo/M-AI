/*
 * Records the opening of every /creator demo note in the app's read-aloud voice.
 *
 * The demo cannot synthesize (no account, no key), so the first minute or so of each note — its
 * first chunks, planned exactly as the read-aloud player plans them — is rendered here once and
 * committed: public/creator-demo/read-aloud/<locale>/<lectureId>-<chunk>.mp3, with the word
 * timings in src/lib/creator-demo/read-aloud-clips.json (see read-aloud-clips.ts for how the
 * demo uses them). The voice is the default one, Grace, which Gemini speaks as Kore; the timings
 * come from a Soniox transcription of each clip, aligned to the note's words the same way the
 * app aligns its own read-aloud.
 *
 * Re-run after editing a demo note; a clip whose text no longer matches is ignored by the demo,
 * and tests/creator-demo-read-aloud.test.mjs fails until it is regenerated.
 *
 * Needs GEMINI_API_KEY and SONIOX_API_KEY in .env.local, and ffmpeg on the PATH.
 *
 * Usage:  node --experimental-strip-types scripts/generate-creator-demo-read-aloud.mjs
 *           [--locale sl] [--note demo-note-erp] [--force]
 */

import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SonioxNodeClient } from "@soniox/node";

import { geminiMp3 } from "./lib/gemini-speech.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* The demo's modules use the `@/` alias; resolve it for Node the way the tests do. */
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      if (specifier.startsWith("@/")) {
        const base = ${JSON.stringify(pathToFileURL(path.join(ROOT, "src")).href + "/")} + specifier.slice(2);
        for (const candidate of [base + ".ts", base + ".tsx", base + "/index.ts", base]) {
          try {
            return await next(candidate, context);
          } catch {}
        }
      }
      return next(specifier, context);
    }
  `)}`,
);

const { buildDemoSeed } = await import("../src/lib/creator-demo/build.ts");
const { buildNoteTtsChunks, parseNoteTtsDocument, stripLeadingRedundantHeading } = await import(
  "../src/lib/note-tts-text.ts"
);
const { toSpeechScript } = await import("../src/lib/speech-language.ts");
const { alignTtsTokensToWords } = await import("../src/lib/note-tts-alignment.ts");
const { demoReadAloudKey } = await import("../src/lib/creator-demo/read-aloud-clips.ts");

const LOCALES = ["sl", "en", "hr", "bs", "sr"];
const VOICE = "Grace";
/*
 * Chunks are taken until their planned length passes this. The planner's estimate runs long against
 * Gemini's pace (a planned 50 s came out at 39 s), so this is what lands near a real minute.
 */
const OPENING_SECONDS = 60;
/* The other shipped clips use 32 kbps mono: clean on speech, light in the repo. */
const BITRATE = 32_000;
const TIMEOUT_MS = 120_000;
const TAKES = 4;
/* A take whose transcript misses more of the chunk's words than this is made again. */
const MIN_MATCHED_SHARE = 0.9;

const OUT_DIR = path.join(ROOT, "public", "creator-demo", "read-aloud");
const MANIFEST = path.join(ROOT, "src", "lib", "creator-demo", "read-aloud-clips.json");

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
      const value = line.slice(separator + 1).trim().replace(/^"|"$/g, "");

      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

/*
 * A word whose timing was interpolated (the transcript did not catch it) can start a little before
 * the matched word in front of it. The highlight should never step backwards, so starts are held in
 * order and every end kept after its own start.
 */
function inOrder(alignment, durationMs) {
  let last = 0;

  return alignment.map((word) => {
    const startMs = Math.min(Math.max(word.startMs, last), durationMs);
    last = startMs;

    return { ...word, startMs, endMs: Math.min(Math.max(word.endMs, startMs + 80), durationMs) };
  });
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

const normalize = (word) => word.normalize("NFKD").replace(/\p{Mark}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

async function transcribe(client, audio, language) {
  const transcription = await client.stt.transcribe({
    model: process.env.SONIOX_MODEL || "stt-async-v4",
    file: audio,
    filename: "demo-read-aloud.mp3",
    language_hints: [language],
    language_hints_strict: true,
    wait: true,
    cleanup: ["file", "transcription"],
  });

  if (transcription.status !== "completed") {
    throw new Error(transcription.error_message || `transcription ${transcription.status}`);
  }

  const transcript = transcription.transcript ?? (await transcription.getTranscript());

  return (transcript?.tokens ?? []).flatMap((token) =>
    typeof token.start_ms === "number" && typeof token.end_ms === "number"
      ? [{ text: token.text, start_ms: token.start_ms, end_ms: token.end_ms, is_audio_event: token.is_audio_event }]
      : [],
  );
}

/* How many of the chunk's words the transcript contains, in order — the take's faithfulness. */
function matchedShare(words, tokens) {
  const heard = tokens.map((token) => token.text).join("").split(/\s+/u).map(normalize).filter(Boolean);
  let at = 0;
  let matched = 0;

  for (const word of words.map((item) => normalize(item.text)).filter(Boolean)) {
    const found = heard.indexOf(word, at);

    if (found >= 0 && found - at <= 3) {
      matched += 1;
      at = found + 1;
    }
  }

  return matched / Math.max(1, words.filter((item) => normalize(item.text)).length);
}

async function main() {
  loadEnv();

  if (!process.env.SONIOX_API_KEY) {
    throw new Error("SONIOX_API_KEY is not set — put it in .env.local.");
  }

  const client = new SonioxNodeClient({ api_key: process.env.SONIOX_API_KEY });
  const onlyLocale = arg("locale");
  const onlyNote = arg("note");
  const force = process.argv.includes("--force");
  const manifest = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
    : { voice: VOICE, clips: {} };

  manifest.voice = VOICE;

  for (const locale of LOCALES) {
    if (onlyLocale && onlyLocale !== locale) {
      continue;
    }

    const seed = buildDemoSeed(locale);
    manifest.clips[locale] ??= {};

    for (const [lectureId, detail] of Object.entries(seed.details)) {
      if (onlyNote && onlyNote !== lectureId) {
        continue;
      }

      const notes = detail?.artifact?.structured_notes_md;

      if (!notes) {
        continue;
      }

      const document = parseNoteTtsDocument(stripLeadingRedundantHeading(notes, detail?.lecture.title));
      const chunks = buildNoteTtsChunks(document);
      const opening = [];
      let planned = 0;

      for (const chunk of chunks) {
        if (planned >= OPENING_SECONDS) {
          break;
        }

        opening.push(chunk);
        planned += chunk.estimatedSeconds;
      }

      const existing = manifest.clips[locale][lectureId] ?? [];
      const clips = [];

      for (const chunk of opening) {
        const key = demoReadAloudKey(chunk.text);
        const file = path.join(OUT_DIR, locale, `${lectureId}-${chunk.chunkIndex}.mp3`);
        const kept = existing.find((clip) => clip.chunkIndex === chunk.chunkIndex);

        if (!force && kept?.key === key && fs.existsSync(file)) {
          clips.push(kept);
          continue;
        }

        const speech = toSpeechScript(chunk.text, locale);
        const words = document.words
          .slice(chunk.wordStartIndex, chunk.wordEndIndex)
          .map((word) => ({ ...word, text: toSpeechScript(word.text, locale) }));
        let best = null;

        for (let take = 1; take <= TAKES; take += 1) {
          const { audio, durationMs } = await geminiMp3({
            text: speech,
            voice: VOICE,
            language: locale,
            bitrate: BITRATE,
            timeoutMs: TIMEOUT_MS,
          });
          const tokens = await transcribe(client, audio, locale);
          const share = matchedShare(words, tokens);

          if (!best || share > best.share) {
            best = { audio, durationMs, tokens, share };
          }

          if (share >= MIN_MATCHED_SHARE) {
            break;
          }

          console.log(`  ${locale}/${lectureId}#${chunk.chunkIndex}: take ${take} matched ${(share * 100).toFixed(0)}%, again`);
        }

        if (best.share < MIN_MATCHED_SHARE) {
          throw new Error(
            `${locale}/${lectureId}#${chunk.chunkIndex}: no take said the chunk (${(best.share * 100).toFixed(0)}% of words)`,
          );
        }

        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, best.audio);
        clips.push({
          chunkIndex: chunk.chunkIndex,
          key,
          durationMs: Math.round(best.durationMs),
          alignment: alignTtsTokensToWords({
            words,
            tokens: best.tokens,
            wordStartIndex: chunk.wordStartIndex,
            durationMs: best.durationMs,
          }),
        });
        console.log(
          `${path.relative(ROOT, file)} — ${(best.audio.length / 1024).toFixed(0)} KB, ` +
            `${(best.durationMs / 1000).toFixed(1)} s, ${(best.share * 100).toFixed(0)}% of words heard`,
        );
      }

      manifest.clips[locale][lectureId] = clips.map((clip) => ({ ...clip, alignment: inOrder(clip.alignment, clip.durationMs) }));
      fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest)}\n`);
    }
  }

  console.log(`Wrote ${path.relative(ROOT, MANIFEST)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
