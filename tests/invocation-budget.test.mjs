import assert from "node:assert/strict";
import test from "node:test";

import { getCurrentAbortSignal } from "../src/lib/abort-context.ts";
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

test("aborts the losing run's signal when the deadline fires", async () => {
  // The 2026-08-25 spike: the deadline rejected the race, but the losing pipeline kept running
  // as a zombie — completing, saving notes, and buying tokens next to the retry that replaced
  // it. The budget now installs an abort signal around the run; every AI call reads it through
  // the abort context and dies with the budget.
  let observedSignal;

  await assert.rejects(
    runWithinInvocationBudget({
      run: () => {
        observedSignal = getCurrentAbortSignal();
        return new Promise(() => {});
      },
      budgetMs: 20,
      deadlineMessage: "deadline",
    }),
    InvocationBudgetExceededError,
  );

  assert.ok(observedSignal instanceof AbortSignal, "the run sees the budget's signal");
  assert.equal(observedSignal.aborted, true, "the deadline aborts the losing run");
});

test("a run that finishes in time sees a signal that was still live", async () => {
  let abortedDuringRun;

  const result = await runWithinInvocationBudget({
    run: async () => {
      abortedDuringRun = getCurrentAbortSignal()?.aborted;
      return "done";
    },
    budgetMs: 60_000,
    deadlineMessage: "unused",
  });

  assert.equal(result, "done");
  assert.equal(abortedDuringRun, false);
});

test("a late rejection from the aborted run stays handled", async () => {
  // The losing run now rejects once the abort lands. That rejection must never surface as an
  // unhandled one — the deadline error already reported the failure.
  let rejectLoser;

  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);

  try {
    await assert.rejects(
      runWithinInvocationBudget({
        run: () =>
          new Promise((_, reject) => {
            rejectLoser = reject;
          }),
        budgetMs: 20,
        deadlineMessage: "deadline",
      }),
      InvocationBudgetExceededError,
    );

    rejectLoser(new Error("aborted after the race was lost"));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
