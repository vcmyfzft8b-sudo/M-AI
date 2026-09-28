import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isRetryableAiError } from "../src/lib/ai/errors.ts";

/**
 * Sentry MEMOAI-WEB-4Q (issue 149974795), 2026-09-28T16:06:29Z: one slide image in a PowerPoint
 * deck got Google's 503 "high demand" answer. The call had a single attempt, so the image's text
 * was dropped from the note, and the handled, transient outage opened a Sentry issue. The same
 * shape was fixed for document images in PR #305 (tests/document-image-description-retry.test.mjs).
 */
const SOURCE = readFileSync(new URL("../src/lib/manual-lectures.ts", import.meta.url), "utf8");
const START = SOURCE.indexOf("async function extractVisualTextFromPptxSlideImages");
const END = SOURCE.indexOf("async function extractTextFromPptx", START);
const VISION_SOURCE = SOURCE.slice(START, END);

const PRODUCTION_ERROR =
  '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}';

test("a slide image gets one more attempt after a transient provider failure", () => {
  assert.ok(START > 0 && END > START, "extractVisualTextFromPptxSlideImages must remain discoverable");
  assert.match(VISION_SOURCE, /maxAttempts:\s*PPTX_VISION_MAX_ATTEMPTS/);
  assert.match(SOURCE, /const PPTX_VISION_MAX_ATTEMPTS = 2;/);
});

test("an exhausted transient outage skips the image without opening a Sentry defect", () => {
  assert.equal(isRetryableAiError(new Error(PRODUCTION_ERROR)), true);

  const transientGuard = VISION_SOURCE.indexOf("if (isRetryableAiError(error))");
  const skip = VISION_SOURCE.indexOf("continue;", transientGuard);
  const capture = VISION_SOURCE.indexOf("captureBackgroundError(error", transientGuard);

  assert.ok(transientGuard > 0, "transient provider failures must be classified");
  assert.ok(skip > transientGuard && skip < capture, "the transient case must leave before the capture");
  assert.ok(capture > transientGuard, "unexpected slide-image failures must stay visible in Sentry");
  assert.match(VISION_SOURCE, /operation: "pptx_slide_image_extraction"/);
});
