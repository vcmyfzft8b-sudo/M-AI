import assert from "node:assert/strict";
import test from "node:test";

import { PartMediaResolutionLevel } from "@google/genai";

import { resolvePartMediaResolution } from "../src/lib/ai/gemini-models.ts";

const MEDIUM = PartMediaResolutionLevel.MEDIA_RESOLUTION_MEDIUM;
const HIGH = PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH;

// The shape of the production incident: describeDocumentImage sent a per-part media resolution
// to GEMINI_TEXT_MODEL (gemini-2.5-flash-lite). Every generateContent came back
// 400 INVALID_ARGUMENT, so every embedded image fell back to "Embedded image from Page N."
test("a 2.5 model never receives a per-part media resolution", () => {
  assert.equal(resolvePartMediaResolution("gemini-2.5-flash-lite", MEDIUM), undefined);
  assert.equal(resolvePartMediaResolution("gemini-2.5-flash", MEDIUM), undefined);
  assert.equal(resolvePartMediaResolution("gemini-2.5-pro", HIGH), undefined);
});

test("a Gemini 3 model keeps the requested media resolution", () => {
  assert.equal(resolvePartMediaResolution("gemini-3.1-flash-lite", MEDIUM), MEDIUM);
  assert.equal(resolvePartMediaResolution("gemini-3-flash-preview", HIGH), HIGH);
  assert.equal(resolvePartMediaResolution("gemini-4-flash", MEDIUM), MEDIUM);
});

test("an unrecognised model name drops the field rather than risking the whole call", () => {
  assert.equal(resolvePartMediaResolution("tunedModels/my-extractor", MEDIUM), undefined);
  assert.equal(resolvePartMediaResolution("", MEDIUM), undefined);
});

test("callers that ask for no media resolution stay unchanged on every model", () => {
  assert.equal(resolvePartMediaResolution("gemini-3.1-flash-lite", undefined), undefined);
  assert.equal(resolvePartMediaResolution("gemini-2.5-flash-lite", undefined), undefined);
});
