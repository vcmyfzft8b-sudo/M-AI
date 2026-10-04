import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

/*
 * A misread photo is never caught later: wrong words still pass the length check and become the
 * note. On full-page handwriting the lite reader at medium resolution misread 1.4 words a page,
 * mostly names and rare terms, and the stronger reader at high resolution misread none
 * (scripts/ocr-eval.mjs, Oct 2026). So the first reading of a photo has to be the stronger one.
 */

const source = fs.readFileSync(new URL("../src/lib/manual-lectures.ts", import.meta.url), "utf8");
const reader = source.slice(
  source.indexOf("export async function extractTextFromImage"),
  source.indexOf("async function updateLectureEnrichmentProcessingStage"),
);
// One entry per plan: each `stage:` up to the next, read on its own so key order does not matter.
const plans = reader
  .split(/(?=\bstage: "ocr_)/)
  .slice(1)
  .map((plan) => ({
    stage: plan.match(/stage: "(ocr_\w+)"/)?.[1],
    model: plan.match(/\bmodel: env\.(\w+)/)?.[1],
    resolution: plan.match(/mediaResolution: "(\w+)"/)?.[1],
  }));

test("a photo is read by the stronger model at high resolution first", () => {
  assert.deepEqual(plans[0], { stage: "ocr_primary", model: "GEMINI_OCR_STRONG_MODEL", resolution: "high" });
});

test("the lite reader stays as the fallback, at high resolution too", () => {
  assert.deepEqual(plans[1], { stage: "ocr_rescue", model: "GEMINI_OCR_LITE_MODEL", resolution: "high" });
});

test("the triage replay reads photos in production's order", () => {
  const replay = fs.readFileSync(new URL("../scripts/replay-failed-note.mjs", import.meta.url), "utf8");

  assert.match(replay, /\["ocr_primary", OCR_STRONG_MODEL, IMAGE_OCR_INSTRUCTIONS\],\s*\["ocr_rescue", OCR_LITE_MODEL, IMAGE_OCR_INSTRUCTIONS\]/);
});

test("the readers are named by role, and the old names still configure them", () => {
  const env = fs.readFileSync(new URL("../src/lib/server-env.ts", import.meta.url), "utf8");

  // Vercel Preview still sets GEMINI_OCR_RESCUE_MODEL; dropping the fallback would silently
  // change which model reads photos there.
  assert.match(env, /GEMINI_OCR_STRONG_MODEL: process\.env\.GEMINI_OCR_STRONG_MODEL \?\? process\.env\.GEMINI_OCR_RESCUE_MODEL,/);
  assert.match(env, /GEMINI_OCR_LITE_MODEL: process\.env\.GEMINI_OCR_LITE_MODEL \?\? process\.env\.GEMINI_OCR_MODEL,/);
  assert.doesNotMatch(source, /env\.GEMINI_OCR_(?:RESCUE_)?MODEL\b/);
});
