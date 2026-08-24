/**
 * OCR bake-off over synthetic slides with known ground truth.
 *
 * Three images: a clean typed slide, the same slide with handwritten margin notes, and a full
 * handwritten page — all Slovenian, with diacritics and a formula. Scores word-level recall
 * separately for typed and handwritten content, so "reads the slide but drops the margin notes"
 * is visible instead of averaged away. Font-rendered handwriting is cleaner than real handwriting,
 * so treat these numbers as an upper bound and confirm on real files.
 *
 *   node scripts/ocr-eval.mjs
 *   node scripts/ocr-eval.mjs --repeat=3
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

// The exact instruction production sends (manual-lectures.ts extractTextFromImage).
const INSTRUCTIONS =
  "Extract all readable text from this photo of notes or printed material. The source is likely Slovenian, so preserve Slovenian characters such as č, š, and ž. Do not translate and do not summarize. Preserve the original language, headings, bullet points, equations, labels, line breaks, and important details. Ignore decorative background elements. If handwriting is uncertain, make the best faithful reading instead of inventing content. Return only the extracted text. Do not include JSON, markdown fences, commentary, or confidence notes.";

const CONFIGS = [
  // Production primary and rescue, exactly as shipped (thinkingBudget: 0).
  { name: "3.1-lite/off*", model: "gemini-3.1-flash-lite", thinking: { thinkingBudget: 0 } },
  { name: "3.1-lite/default", model: "gemini-3.1-flash-lite", thinking: null },
  { name: "3-flash-prev/off*", model: "gemini-3-flash-preview", thinking: { thinkingBudget: 0 } },
  // Candidates.
  { name: "2.5-lite", model: "gemini-2.5-flash-lite", thinking: null },
  { name: "3.5-lite/minimal", model: "gemini-3.5-flash-lite", thinking: { thinkingLevel: "minimal" } },
  { name: "3.5-lite/high", model: "gemini-3.5-flash-lite", thinking: { thinkingLevel: "high" } },
  { name: "3.6-flash/minimal", model: "gemini-3.6-flash", thinking: { thinkingLevel: "minimal" } },
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
      maxOutputTokens: 4000,
      ...(config.thinking ? { thinkingConfig: config.thinking } : {}),
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
const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
const rows = [];

for (const config of CONFIGS) {
  for (const image of images) {
    const samples = [];

    for (let run = 0; run < repeats; run += 1) {
      try {
        const imageFile = fs.existsSync(path.join(OCR_DIR, `${image}.png`))
          ? `${image}.png`
          : `${image}.jpg`;
        const result = await runOcr(config, path.join(OCR_DIR, imageFile), "MEDIA_RESOLUTION_MEDIUM");
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

fs.writeFileSync(path.join(OCR_DIR, "results.json"), JSON.stringify(rows, null, 1));
console.log("\nfull outputs written to evals/ocr/results.json");
