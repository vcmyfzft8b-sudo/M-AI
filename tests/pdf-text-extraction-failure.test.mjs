import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isRetryableAiError, toUserFacingAiErrorMessage } from "../src/lib/ai/errors.ts";
import {
  ExpectedLectureInputError,
  isExpectedLectureInputFailure,
} from "../src/lib/lecture-processing-errors.ts";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const GEMINI_SOURCE = readSource("src/lib/ai/gemini.ts");
const MANUAL_LECTURES_SOURCE = readSource("src/lib/manual-lectures.ts");
const PDF_FALLBACK_SOURCE = MANUAL_LECTURES_SOURCE.slice(
  MANUAL_LECTURES_SOURCE.indexOf("export async function extractTextFromPdf"),
  MANUAL_LECTURES_SOURCE.indexOf("export async function extractTextFromDocument"),
);

// src/lib/ai/gemini.ts is "server-only" and cannot be loaded by the test runner, so stand in for
// the error it throws. The name and the message are all that this test needs to be faithful.
function geminiEmptyTextOutputError() {
  const error = new Error("Model returned empty text output.");
  error.name = "GeminiEmptyTextOutputError";

  return error;
}

function unreadablePdfError() {
  return new ExpectedLectureInputError(
    "No readable text could be found in this PDF. If it is a scan, upload the pages as photos so they can be read with OCR.",
    "pdf_no_text",
  );
}

// Stands in for markLecturePipelineFailed: the two things it does with the error it is handed --
// decide whether it is a defect worth reporting (pipeline.ts:613) and write the learner's failure
// message onto the lecture row.
function markLectureFailed(recorder) {
  return (error) => {
    if (!isExpectedLectureInputFailure(error) && !isRetryableAiError(error)) {
      recorder.captured.push(error);
    }

    recorder.messages.push(toUserFacingAiErrorMessage(error));
  };
}

// The production event (MEMOAI-WEB-2S): a learner uploaded a PDF whose text neither reader could
// find. PDF.js came up under the 40-word bar, then the Gemini fallback answered with nothing on
// all four attempts -- the breadcrumbs show four generateContent calls, every one of them HTTP
// 200 -- and extractTextFromPdf let GeminiEmptyTextOutputError out as if it were a crash.
test("an unreadable PDF used to be reported as a defect and explained in machine language", () => {
  const recorder = { captured: [], messages: [] };

  markLectureFailed(recorder)(geminiEmptyTextOutputError());

  assert.equal(recorder.captured.length, 1, "the production defect: an expected failure reported");
  assert.equal(
    recorder.messages[0],
    "Model returned empty text output.",
    "and the learner is told their lecture failed in the model's words, not their own",
  );
});

test("a PDF with no readable text is the learner's file to fix, not a defect", () => {
  const recorder = { captured: [], messages: [] };

  markLectureFailed(recorder)(unreadablePdfError());

  assert.equal(isExpectedLectureInputFailure(unreadablePdfError()), true);
  assert.deepEqual(recorder.captured, [], "an unreadable file must never reach Sentry");
  assert.match(recorder.messages[0], /scan/, "the learner is told what to do with a scanned PDF");
});

// Both halves of the guard in markLecturePipelineFailed said no, which is why every one of these
// landed in Sentry. Neither would have started saying yes on its own.
test("nothing else was keeping the empty-output error out of Sentry", () => {
  const error = geminiEmptyTextOutputError();

  assert.equal(isExpectedLectureInputFailure(error), false);
  assert.equal(isRetryableAiError(error), false, "an empty answer is not a busy provider");
});

test("the Gemini fallback in extractTextFromPdf classifies an empty answer before it escapes", () => {
  assert.ok(
    PDF_FALLBACK_SOURCE.includes("generateTextWithGeminiFile"),
    "the fallback moved; this test is no longer looking at it",
  );

  const guard = PDF_FALLBACK_SOURCE.indexOf("error instanceof GeminiEmptyTextOutputError");
  const classified = PDF_FALLBACK_SOURCE.indexOf('"pdf_no_text"');

  assert.ok(guard > 0, "an empty Gemini answer still leaves extractTextFromPdf as a raw error");
  assert.ok(classified > guard, "and it has to become an ExpectedLectureInputError to be handled");
  assert.ok(
    PDF_FALLBACK_SOURCE.indexOf("throw error;", guard) > classified,
    "every other Gemini failure is still a defect and must keep being rethrown untouched",
  );
});

// The classification above is an `instanceof` check, so it only works while the retry loop lets
// this one error class out intact. gemini.ts rethrows it deliberately instead of folding it into
// `new Error(toErrorMessage(lastError))` like every other exhausted failure -- if that ever goes,
// a scanned PDF starts failing as a defect again with nothing to catch it by.
test("generateTextWithGeminiFile rethrows the empty-output error unwrapped", () => {
  assert.match(
    GEMINI_SOURCE,
    /if \(lastError instanceof GeminiEmptyTextOutputError\) \{\s*throw lastError;/,
    "the empty-output error is no longer distinguishable once the attempts are spent",
  );
});
