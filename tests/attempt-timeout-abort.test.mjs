import assert from "node:assert/strict";
import test from "node:test";

import { WorkAbortedError, isAttemptTimeoutAbort } from "../src/lib/abort-context.ts";

// What @google/genai throws when an attempt's AbortSignal.timeout fires (measured 2026-09-28).
function sdkAbortError() {
  return new DOMException("This operation was aborted", "AbortError");
}

test("an abort while the budget is still running is the attempt's own timeout", () => {
  const budget = new AbortController();

  assert.equal(isAttemptTimeoutAbort(sdkAbortError(), budget.signal), true);
});

test("an abort after the budget fired stays a budget abort", () => {
  const budget = new AbortController();
  budget.abort();

  assert.equal(isAttemptTimeoutAbort(sdkAbortError(), budget.signal), false);
});

test("an attempt timeout outside any budget is still a timeout", () => {
  assert.equal(isAttemptTimeoutAbort(sdkAbortError(), undefined), true);
});

test("the budget's own cancellation and ordinary errors are not attempt timeouts", () => {
  const budget = new AbortController();

  assert.equal(isAttemptTimeoutAbort(new WorkAbortedError(), budget.signal), false);
  assert.equal(isAttemptTimeoutAbort(new Error("503 overloaded"), budget.signal), false);
  assert.equal(isAttemptTimeoutAbort("This operation was aborted", budget.signal), false);
});
