import assert from "node:assert/strict";
import test from "node:test";

import {
  INVOCATION_BUDGET_SAFETY_MS,
  InvocationBudgetExceededError,
  getInvocationBudgetMs,
  runWithinInvocationBudget,
} from "../src/lib/invocation-budget.ts";

test("keeps a margin under maxDuration so the failure can still be written", () => {
  assert.equal(
    getInvocationBudgetMs({ maxDurationSeconds: 300, elapsedMs: 0 }),
    300_000 - INVOCATION_BUDGET_SAFETY_MS,
  );
});

test("counts the time already spent answering the request", () => {
  assert.equal(
    getInvocationBudgetMs({ maxDurationSeconds: 300, elapsedMs: 1_500 }),
    300_000 - INVOCATION_BUDGET_SAFETY_MS - 1_500,
  );
});

test("never hands out a negative budget", () => {
  assert.equal(getInvocationBudgetMs({ maxDurationSeconds: 300, elapsedMs: 400_000 }), 0);
  assert.equal(getInvocationBudgetMs({ maxDurationSeconds: 10, elapsedMs: 0 }), 0);
});

test("returns the stage's own result when it finishes inside the budget", async () => {
  // A 60s budget on purpose: if the deadline timer outlived the resolved work, this test file
  // would hold the event loop open for a minute instead of finishing immediately.
  const result = await runWithinInvocationBudget({
    run: async () => "transcribed",
    budgetMs: 60_000,
    deadlineMessage: "unused",
  });

  assert.equal(result, "transcribed");
});

test("rejects the stage that would have been killed mid-run by the platform timeout", async () => {
  // The shape of the production failure: transcription plus note generation outlive the
  // invocation, so before this guard nothing threw, nothing was written, and the lecture kept
  // its in-progress status forever.
  await assert.rejects(
    runWithinInvocationBudget({
      run: () => new Promise(() => {}),
      budgetMs: 20,
      deadlineMessage: "Obdelava je trajala predolgo in se je ustavila. Poskusi znova.",
    }),
    (error) => {
      assert.ok(error instanceof InvocationBudgetExceededError);
      assert.equal(error.name, "InvocationBudgetExceededError");
      assert.equal(
        error.message,
        "Obdelava je trajala predolgo in se je ustavila. Poskusi znova.",
      );
      assert.equal(error.budgetMs, 20);
      return true;
    },
  );
});

test("propagates the stage's own failure untouched", async () => {
  const failure = new Error("Transcript is empty.");

  await assert.rejects(
    runWithinInvocationBudget({
      run: async () => {
        throw failure;
      },
      budgetMs: 60_000,
      deadlineMessage: "unused",
    }),
    (error) => error === failure,
  );
});
