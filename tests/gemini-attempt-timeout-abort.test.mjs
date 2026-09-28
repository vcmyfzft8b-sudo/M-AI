import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isAttemptTimeoutAbort, runWithAbortSignal } from "../src/lib/abort-context.ts";
import { isAbortedWorkError, isRetryableAiError } from "../src/lib/ai/errors.ts";

/**
 * Sentry MEMOAI-WEB-4R (issue 150020597), 2026-09-28T20:45:27Z: a scan's OCR call hung for about a
 * minute and was cut off by its own attempt timeout. `@google/genai` relays the abort through a
 * controller of its own with a bare `abort()`, so the call rejected with Node's reasonless
 * "AbortError: This operation was aborted". gemini.ts read that as the invocation budget ending,
 * skipped the retry, and the lecture was failed as a budget overrun 100 seconds into its budget.
 */

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

/** What the SDK's request does with the signal it is given (node/index.mjs, includeExtraHttpOptionsToRequestInit). */
function sdkRequest(signal) {
  const controller = new AbortController();
  signal.addEventListener("abort", () => controller.abort());

  return new Promise((_, reject) => {
    // The open socket of a real request; AbortSignal.timeout's own timer does not hold the loop.
    const inFlight = setTimeout(() => undefined, 60_000);

    controller.signal.addEventListener("abort", () => {
      clearTimeout(inFlight);
      reject(controller.signal.reason);
    });
  });
}

function attemptSignal(budgetSignal, timeoutMs) {
  return AbortSignal.any([budgetSignal, AbortSignal.timeout(timeoutMs)]);
}

test("the SDK turns an attempt timeout into the same AbortError the budget produces", async () => {
  const budget = new AbortController();
  const error = await runWithAbortSignal(budget.signal, () =>
    sdkRequest(attemptSignal(budget.signal, 5)).catch((rejection) => rejection),
  );

  assert.equal(error.name, "AbortError");
  assert.equal(error.message, "This operation was aborted");
  assert.equal(isAbortedWorkError(error), true, "shape alone reads as the budget");
});

test("an attempt timeout with budget left is recognised as a timeout", async () => {
  const budget = new AbortController();

  await runWithAbortSignal(budget.signal, async () => {
    const error = await sdkRequest(attemptSignal(budget.signal, 5)).catch((rejection) => rejection);

    assert.equal(isAttemptTimeoutAbort(error), true);
  });
});

test("the budget ending is still the budget ending", async () => {
  const budget = new AbortController();

  await runWithAbortSignal(budget.signal, async () => {
    const pending = sdkRequest(attemptSignal(budget.signal, 60_000)).catch((rejection) => rejection);
    budget.abort();
    const error = await pending;

    assert.equal(isAttemptTimeoutAbort(error), false);
  });
});

test("non-abort failures are not attempt timeouts", async () => {
  const budget = new AbortController();

  await runWithAbortSignal(budget.signal, async () => {
    assert.equal(isAttemptTimeoutAbort(new Error("503 UNAVAILABLE")), false);

    const workAborted = new Error("The invocation budget is nearly spent; not starting another model call.");
    workAborted.name = "WorkAbortedError";
    assert.equal(isAttemptTimeoutAbort(workAborted), false);
  });
});

test("gemini.ts rewrites an attempt-timeout abort as a retryable timeout", () => {
  const source = readSource("src/lib/ai/gemini.ts");
  const withTimeout = source.slice(
    source.indexOf("async function withTimeout"),
    source.indexOf("function resolveAttemptTimeoutMs"),
  );

  assert.match(withTimeout, /isAttemptTimeoutAbort\(error\)/);
  assert.match(withTimeout, /Promise\.race\(\[attempt, timeoutPromise\]\)/);

  const rewritten = /throw new Error\(`\$\{label\} ([^`]*)`\)/.exec(withTimeout);
  assert.ok(rewritten, "withTimeout throws a labelled error for the attempt timeout");

  const message = `Gemini text extraction ${rewritten[1]}`;
  assert.equal(isRetryableAiError(new Error(message)), true);
  assert.equal(isAbortedWorkError(new Error(message)), false);

  // Every model call that sets an attempt timeout on its signal goes through withTimeout.
  const attemptSignals = source.match(/buildAttemptSignal\(abortSignal, attemptTimeoutMs\)/g) ?? [];
  const wrapped = source.match(/await withTimeout\(/g) ?? [];
  assert.ok(attemptSignals.length > 0);
  assert.equal(wrapped.length, attemptSignals.length);
});
