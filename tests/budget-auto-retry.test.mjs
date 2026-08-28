import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AI_PROCESSING_TOO_LONG_MESSAGE,
  AI_SOURCE_TOO_EXTENSIVE_MESSAGE,
  isBudgetOverrunFailure,
  isRetryableAiError,
  toUserFacingAiErrorMessage,
} from "../src/lib/ai/errors.ts";
import { InvocationBudgetExceededError } from "../src/lib/invocation-budget.ts";
import { canRetryLectureFailureCode } from "../src/lib/lecture-failure-codes.ts";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const PIPELINE_SOURCE = readSource("src/lib/pipeline.ts");

/**
 * The production case this exists for (Sentry MEMOAI-WEB-2N/2Y family, and the 2026-08-27
 * overrun): a run dies on the invocation budget, the lecture is marked failed, and it then sits
 * failed for hours — 3.6 hours on lecture 3a90416b — until the learner finds the retry button.
 * The retry then finishes in about 80 seconds, because every completed stage is checkpointed.
 * The pipeline now presses that button itself, a bounded number of times.
 */

test("every shape the budget family arrives in is recognised", () => {
  // The budget's own rejection, class intact (HTTP-fallback path, same process).
  assert.equal(
    isBudgetOverrunFailure(
      new InvocationBudgetExceededError(AI_PROCESSING_TOO_LONG_MESSAGE, 280_000),
    ),
    true,
  );

  // The same rejection on the far side of an Inngest step boundary: class gone, name flattened
  // to "Error", only the sentence left.
  const flattened = new Error(AI_PROCESSING_TOO_LONG_MESSAGE);
  flattened.name = "Error";
  assert.equal(isBudgetOverrunFailure(flattened), true);

  // The cancelled work's rejection winning the race instead (the 2026-08-27 event).
  assert.equal(
    isBudgetOverrunFailure(new DOMException("This operation was aborted", "AbortError")),
    true,
  );

  const workAborted = new Error("The invocation budget ran out; remaining work was cancelled.");
  workAborted.name = "WorkAbortedError";
  assert.equal(isBudgetOverrunFailure(workAborted), true);
});

test("nothing outside the budget family is auto-retried", () => {
  for (const other of [
    new Error("Gemini exploded"),
    new Error("Transcript is empty."),
    new Error("503 Service Unavailable"),
    { code: "PGRST116", message: "Cannot coerce the result to a single JSON object" },
    null,
    undefined,
  ]) {
    assert.equal(isBudgetOverrunFailure(other), false, String(other));
  }
});

test("the terminal message tells the learner the material is the cause, and stays unretryable", () => {
  // The sentence must not contain any keyword the retryable classifier matches, or a rethrow of
  // it would flip back to "temporarily overloaded, try again".
  assert.equal(isRetryableAiError(new Error(AI_SOURCE_TOO_EXTENSIVE_MESSAGE)), false);

  // And the message mapper must pass it through untouched, not translate it into something else.
  assert.equal(
    toUserFacingAiErrorMessage(new Error(AI_SOURCE_TOO_EXTENSIVE_MESSAGE)),
    AI_SOURCE_TOO_EXTENSIVE_MESSAGE,
  );

  // The code the terminal branch stamps is already in the unretryable set, so the retry button
  // disappears with no UI change.
  assert.equal(canRetryLectureFailureCode("source_too_large"), false);
});

/** The counter ladder as markLecturePipelineFailed walks it: run 1 retries, run 2 retries, run 3 stops. */
function decide({ storedCount, budgetOverrun, maxRuns = 3 }) {
  const budgetFailureRuns = budgetOverrun ? storedCount + 1 : 0;

  if (budgetOverrun && budgetFailureRuns < maxRuns) {
    return { action: "auto-retry", write: budgetFailureRuns };
  }

  if (budgetOverrun) {
    return { action: "terminal", write: budgetFailureRuns, code: "source_too_large" };
  }

  return { action: "ordinary-failure", write: null };
}

test("two automatic retries, then the material is called too extensive", () => {
  assert.deepEqual(decide({ storedCount: 0, budgetOverrun: true }), {
    action: "auto-retry",
    write: 1,
  });
  assert.deepEqual(decide({ storedCount: 1, budgetOverrun: true }), {
    action: "auto-retry",
    write: 2,
  });
  assert.deepEqual(decide({ storedCount: 2, budgetOverrun: true }), {
    action: "terminal",
    write: 3,
    code: "source_too_large",
  });

  // A manual retry after the terminal verdict that overruns again goes straight back to
  // terminal — the exhausted count survives on the row.
  assert.equal(decide({ storedCount: 3, budgetOverrun: true }).action, "terminal");

  // A non-budget failure is untouched by any of this, whatever the count says.
  assert.equal(decide({ storedCount: 2, budgetOverrun: false }).action, "ordinary-failure");
});

test("the budget branch sits before the Sentry-and-capture tail", () => {
  const start = PIPELINE_SOURCE.indexOf("export async function markLecturePipelineFailed");

  assert.ok(start > 0);

  const body = PIPELINE_SOURCE.slice(start);
  const branch = body.indexOf("const budgetOverrun = isBudgetOverrunFailure(params.error)");
  const tailLog = body.indexOf('console.error("[lecture-pipeline] Lecture failed", logPayload)');
  const capture = body.indexOf("captureGenerationFailureInput");

  assert.ok(branch > 0, "the budget branch must exist");
  assert.ok(tailLog > branch, "an auto-retried overrun must not reach the ordinary failure log");
  assert.ok(capture > branch, "an auto-retried overrun must not snapshot a failure capture");
});

test("the auto-retry log line does not wear the triage automation's prefix", () => {
  // The error-triage scanner treats every log line containing "[lecture-pipeline]" as
  // actionable. A failure the pipeline is already retrying by itself must not wake it.
  const line = PIPELINE_SOURCE.match(/^.*retrying automatically.*$/m);

  assert.ok(line, "the auto-retry warn line must exist");
  assert.ok(!line[0].includes("[lecture-pipeline]"), line[0]);
});

test("the terminal branch writes the too-extensive message and its code", () => {
  assert.ok(/budgetRetriesExhausted\s*\?\s*AI_SOURCE_TOO_EXTENSIVE_MESSAGE/.test(PIPELINE_SOURCE));
  assert.ok(/budgetRetriesExhausted\s*\?\s*"source_too_large"/.test(PIPELINE_SOURCE));
});

test("reaching ready clears the budget-failure count", () => {
  const start = PIPELINE_SOURCE.indexOf("async function updateLectureProcessingState");
  const body = PIPELINE_SOURCE.slice(start, start + 2200);

  assert.ok(/BUDGET_FAILURE_COUNT_KEY.*\.\.\.withoutBudgetFailures/s.test(body));
  assert.ok(/params\.stage === "ready" \? withoutBudgetFailures : stored/.test(body));
});

test("the retry job mirrors the manual retry route's choices", () => {
  const start = PIPELINE_SOURCE.indexOf("async function enqueueBudgetOverrunRetry");

  assert.ok(start > 0);

  const body = PIPELINE_SOURCE.slice(start, PIPELINE_SOURCE.indexOf("\n}\n", start));
  // Same order and same jobs as src/app/api/lectures/[id]/retry: a pending document or link
  // re-runs its extraction, audio re-runs the full pipeline, a manual import regenerates notes —
  // and anything the route would refuse (a scan mid-OCR) is refused here too, by returning false.
  for (const call of [
    "enqueueLectureDocumentProcessing",
    "enqueueLectureLinkProcessing",
    "enqueueLectureProcessing",
    "enqueueLectureNotesGeneration",
  ]) {
    assert.ok(body.includes(call), call);
  }
  assert.ok(body.includes("return false"));
});
