import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Sentry MEMOAI-WEB-53 (issue 151273960), 2026-10-04T17:13:04Z: an image in a PowerPoint deck was
 * withheld by Gemini as RECITATION ("Model withheld a verbatim copy of the source"). The slide
 * reader only ever asked for an exact transcription, so the image's content was dropped from the
 * note and the handled empty answer opened a Sentry issue. The photo and PDF readers already ask
 * for a restatement when the verbatim reading is withheld (src/lib/ocr-prompts.ts).
 */
const SOURCE = readFileSync(new URL("../src/lib/manual-lectures.ts", import.meta.url), "utf8");
const START = SOURCE.indexOf("async function extractVisualTextFromPptxSlideImages");
const END = SOURCE.indexOf("async function extractTextFromPptx", START);
const VISION_SOURCE = SOURCE.slice(START, END);

test("a withheld slide image is asked for again as a restatement", () => {
  assert.ok(START > 0 && END > START, "extractVisualTextFromPptxSlideImages must remain discoverable");

  const guard = VISION_SOURCE.indexOf("if (!isGeminiRecitationBlock(error))");
  const restate = VISION_SOURCE.indexOf("readImage(restateInstructions)", guard);

  assert.ok(guard > 0, "a RECITATION block must be recognised");
  assert.ok(restate > guard, "the recognised block must be retried with the restatement prompt");
  assert.match(VISION_SOURCE, /const restateInstructions = `[^`]*Do not copy printed sentences word for word/);
  assert.match(VISION_SOURCE, /const restateInstructions = `[^`]*\$\{PPTX_VISION_NO_CONTENT_MARKER\}`/);
});

test("an image that stays empty is skipped without opening a Sentry defect", () => {
  const emptyGuard = VISION_SOURCE.indexOf("if (error instanceof GeminiEmptyTextOutputError)");
  const skip = VISION_SOURCE.indexOf("continue;", emptyGuard);
  const capture = VISION_SOURCE.indexOf("captureBackgroundError(error", emptyGuard);

  assert.ok(emptyGuard > 0, "an empty answer must be classified");
  assert.ok(skip > emptyGuard && skip < capture, "the empty case must leave before the capture");
  assert.match(VISION_SOURCE, /operation: "pptx_slide_image_extraction"/);
});
