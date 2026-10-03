/**
 * OCR bake-off over synthetic photos with known ground truth.
 *
 * Two kinds of image: the original small fixtures (a typed slide, the slide with handwritten margin
 * notes, seven large handwritten lines), and full A4 pages of small handwriting shot as a phone
 * photo at the size the app uploads (scripts/ocr-make-pages.py). Scores word-level recall
 * separately for typed and handwritten content, so "reads the slide but drops the margin notes"
 * is visible instead of averaged away. Font-rendered handwriting is cleaner than a real hand, so
 * treat these numbers as an upper bound and confirm on real files.
 *
 *   node --experimental-strip-types scripts/ocr-eval.mjs
 *   node --experimental-strip-types scripts/ocr-eval.mjs --repeat=3 --images=notes-pharma,notes-history
 *   node --experimental-strip-types scripts/ocr-eval.mjs --configs=lite/medium,flash-prev/high
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GoogleGenAI } from "@google/genai";

import { loadEnv, PRICES } from "./lib/eval-runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OCR_DIR = path.join(ROOT, "evals", "ocr");

loadEnv(ROOT);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// The instruction production sends, read from the file production reads it from: the copy pasted
// here before went stale and was missing the orientation sentence.
const { IMAGE_OCR_INSTRUCTIONS: INSTRUCTIONS } = await import("../src/lib/ocr-prompts.ts");

// Thinking exactly as production sends it, so a change to that rule reaches the bake-off too.
const { resolveMinimalThinkingConfig } = await import("../src/lib/ai/gemini-models.ts");

const CONFIGS = [
  // Production: the primary reader, then the rescue that only runs when the primary fails.
  { name: "lite/medium*", model: "gemini-3.5-flash-lite", resolution: "MEDIA_RESOLUTION_MEDIUM" },
  { name: "flash-prev/high*", model: "gemini-3-flash-preview", resolution: "MEDIA_RESOLUTION_HIGH" },
  // Candidates for the primary.
  { name: "lite/high", model: "gemini-3.5-flash-lite", resolution: "MEDIA_RESOLUTION_HIGH" },
  { name: "flash-prev/medium", model: "gemini-3-flash-preview", resolution: "MEDIA_RESOLUTION_MEDIUM" },
  { name: "3.6-flash/high", model: "gemini-3.6-flash", resolution: "MEDIA_RESOLUTION_HIGH" },
];

function normalizeWords(value) {
  return value
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

/** Fraction of ground-truth words present in the OCR output (order-agnostic, multiset). */
function wordRecall(truthLines, outputText) {
  const available = new Map();

  for (const word of normalizeWords(outputText)) {
    available.set(word, (available.get(word) ?? 0) + 1);
  }

  let total = 0;
  let matched = 0;

  for (const line of truthLines) {
    for (const word of normalizeWords(line)) {
      total += 1;
      const remaining = available.get(word) ?? 0;

      if (remaining > 0) {
        matched += 1;
        available.set(word, remaining - 1);
      }
    }
  }

  return total === 0 ? null : matched / total;
}

function diacriticsPreserved(truthLines, outputText) {
  const expected = (truthLines.join(" ").match(/[čšžČŠŽ]/g) ?? []).length;
  const found = (outputText.match(/[čšžČŠŽ]/g) ?? []).length;

  return expected === 0 ? null : Math.min(1, found / expected);
}

async function runOcr(config, imagePath, mediaResolution) {
  const bytes = fs.readFileSync(imagePath);
  const majorVersion = Number.parseInt(config.model.match(/gemini-(\d+)/)?.[1] ?? "0", 10);
  const part = {
    inlineData: {
      mimeType: imagePath.endsWith(".jpg") ? "image/jpeg" : "image/png",
      data: bytes.toString("base64"),
    },
    // Same gate as resolvePartMediaResolution: 2.5 models reject the field outright.
    // The REST shape is an object with a level, not the bare enum string.
    ...(majorVersion >= 3 ? { mediaResolution: { level: mediaResolution } } : {}),
  };
  const startedAt = Date.now();
  const response = await ai.models.generateContent({
    model: config.model,
    contents: [{ role: "user", parts: [part, { text: INSTRUCTIONS }] }],
    config: {
      // OCR_RESCUE_MAX_OUTPUT_TOKENS: a dense page must not be cut off by the cap.
      maxOutputTokens: 6000,
      thinkingConfig: resolveMinimalThinkingConfig(config.model),
    },
  });
  const usage = response.usageMetadata ?? {};
  const price = PRICES[config.model] ?? { input: 0, output: 0 };

  return {
    text: response.text ?? "",
    elapsedMs: Date.now() - startedAt,
    thoughtTokens: usage.thoughtsTokenCount ?? 0,
    costUsd:
      ((usage.promptTokenCount ?? 0) * price.input +
        ((usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)) * price.output) /
      1_000_000,
  };
}

const args = process.argv.slice(2);
const repeats = Number.parseInt(args.find((arg) => arg.startsWith("--repeat="))?.split("=")[1] ?? "1", 10);
const truth = JSON.parse(fs.readFileSync(path.join(OCR_DIR, "truth.json"), "utf8"));
const wantedImages = args.find((arg) => arg.startsWith("--images="))?.split("=")[1]?.split(",");
const images = Object.keys(truth).filter((image) => !wantedImages || wantedImages.includes(image));
const wantedConfigs = args.find((arg) => arg.startsWith("--configs="))?.split("=")[1]?.split(",");
const configs = CONFIGS.filter(
  (config) => !wantedConfigs || wantedConfigs.includes(config.name.replace(/\*$/, "")),
);
const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
const rows = [];

for (const config of configs) {
  for (const image of images) {
    const samples = [];

    for (let run = 0; run < repeats; run += 1) {
      try {
        const imageFile = fs.existsSync(path.join(OCR_DIR, `${image}.png`))
          ? `${image}.png`
          : `${image}.jpg`;
        const result = await runOcr(config, path.join(OCR_DIR, imageFile), config.resolution);
        const truthEntry = truth[image];

        samples.push({
          typed: wordRecall(truthEntry.typed, result.text),
          handwritten: wordRecall(truthEntry.handwritten, result.text),
          diacritics: diacriticsPreserved([...truthEntry.typed, ...truthEntry.handwritten], result.text),
          thoughtTokens: result.thoughtTokens,
          elapsedMs: result.elapsedMs,
          costUsd: result.costUsd,
          text: result.text,
        });
      } catch (error) {
        samples.push({ error: String(error.message).slice(0, 120) });
      }
    }

    rows.push({ config: config.name, image, samples });
  }
}

console.log(
  ["config", "image", "typed", "handwr", "č/š/ž", "thoughts", "ms", "cost"]
    .map((header, index) => header.padEnd([19, 18, 8, 8, 7, 9, 6, 9][index]))
    .join(""),
);

for (const row of rows) {
  const ok = row.samples.filter((sample) => !sample.error);

  if (ok.length === 0) {
    console.log(`${row.config.padEnd(19)}${row.image.padEnd(18)}ERROR ${row.samples[0].error}`);
    continue;
  }

  const fmt = (key) => {
    const values = ok.map((sample) => sample[key]).filter((value) => value != null);

    return values.length === 0 ? "-" : `${(mean(values) * 100).toFixed(0)}%`;
  };

  console.log(
    [
      row.config.padEnd(19),
      row.image.padEnd(18),
      fmt("typed").padEnd(8),
      fmt("handwritten").padEnd(8),
      fmt("diacritics").padEnd(7),
      String(Math.round(mean(ok.map((sample) => sample.thoughtTokens)))).padEnd(9),
      String(Math.round(mean(ok.map((sample) => sample.elapsedMs)))).padEnd(6),
      `$${mean(ok.map((sample) => sample.costUsd)).toFixed(5)}`.padEnd(9),
    ].join(""),
  );
}

// Only a full run replaces the committed record; a filtered run must not overwrite it with a subset.
const resultsFile = wantedImages || wantedConfigs ? "results-partial.json" : "results.json";
fs.writeFileSync(path.join(OCR_DIR, resultsFile), JSON.stringify(rows, null, 1));
console.log(`\nfull outputs written to evals/ocr/${resultsFile}`);
