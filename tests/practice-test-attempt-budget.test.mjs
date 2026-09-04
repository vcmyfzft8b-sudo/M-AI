import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  INVOCATION_BUDGET_SAFETY_MS,
  InvocationBudgetExceededError,
  getInvocationBudgetMs,
  runWithinInvocationBudget,
} from "../src/lib/invocation-budget.ts";

const ROUTE_PATH = "src/app/api/lectures/[id]/practice-test/attempt/route.ts";
const ROUTE_SOURCE = readFileSync(
  fileURLToPath(new URL(`../${ROUTE_PATH}`, import.meta.url)),
  "utf8",
);
const SUBMIT_ROUTE_PATH =
  "src/app/api/lectures/[id]/practice-test/attempt/[attemptId]/submit/route.ts";
const SUBMIT_ROUTE_SOURCE = readFileSync(
  fileURLToPath(new URL(`../${SUBMIT_ROUTE_PATH}`, import.meta.url)),
  "utf8",
);

// The production failure: POST /api/lectures/<id>/practice-test/attempt builds the question bank
// inline when there is none, ran the full 300 seconds, and was killed. The kill left the reader
// with a gateway page, and — because generateLecturePracticeTest's own catch died with the
// invocation — the asset stayed on "generating", which the workspace polls forever and which makes
// the next attempt start the same doomed generation again.
test("an attempt that outlives the invocation rejects in time to record the stall", async () => {
  let recorded = null;

  try {
    await runWithinInvocationBudget({
      // A bank generation that never returns, as the killed invocation saw it. The tiny budget
      // stands in for the 280 seconds so the test does not wait them out.
      run: () => new Promise(() => {}),
      budgetMs: 20,
      deadlineMessage: "Priprava preizkusa je trajala predolgo in se je ustavila. Poskusi znova.",
    });
  } catch (error) {
    // Stands in for markStalledPracticeTestGenerationFailed plus the 503 answer.
    recorded = error;
  }

  assert.ok(recorded instanceof InvocationBudgetExceededError);
  assert.equal(
    recorded.message,
    "Priprava preizkusa je trajala predolgo in se je ustavila. Poskusi znova.",
  );
});

test("the budget leaves the route time to answer after the deadline", () => {
  // Time already spent on auth, rate limiting and the ownership check counts against the budget,
  // so the margin is what is left for the failure write and the response.
  assert.equal(
    getInvocationBudgetMs({ maxDurationSeconds: 300, elapsedMs: 2_000 }),
    300_000 - INVOCATION_BUDGET_SAFETY_MS - 2_000,
  );
});

test("the route declares the limit its budget is measured against", () => {
  assert.match(ROUTE_SOURCE, /export const maxDuration = 300/);
  assert.match(ROUTE_SOURCE, /maxDurationSeconds: maxDuration/);
});

test("starting an attempt runs inside the budget and records a stalled generation", () => {
  assert.match(ROUTE_SOURCE, /runWithinInvocationBudget\(\{[\s\S]*createPracticeTestAttempt/);
  assert.match(
    ROUTE_SOURCE,
    /InvocationBudgetExceededError[\s\S]*markStalledPracticeTestGenerationFailed/,
  );
});

// Submitting a test grades every answer on it — a dozen model calls in waves, the same order of
// work every other practice-test route declares 300 seconds for. This route declared nothing and
// took the platform default, and an invocation killed there takes submitPracticeTestAttempt's own
// catch with it: the attempt stays "submitted", which the workspace shows as neither a test to
// sit nor a result to read.
test("submitting a test is given the same invocation budget as starting one", () => {
  assert.match(SUBMIT_ROUTE_SOURCE, /export const maxDuration = 300/);
  assert.match(SUBMIT_ROUTE_SOURCE, /maxDurationSeconds: maxDuration/);
});

test("a submission that outlives the invocation frees the attempt instead of stranding it", () => {
  assert.match(SUBMIT_ROUTE_SOURCE, /markStalledPracticeTestAttemptFailed/);
  assert.match(SUBMIT_ROUTE_SOURCE, /InvocationBudgetExceededError/);
  assert.match(SUBMIT_ROUTE_SOURCE, /status: 503/);
});
