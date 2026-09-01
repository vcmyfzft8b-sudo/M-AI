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

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const FUNCTIONS_SOURCE = readSource("src/inngest/functions.ts");
const ROUTE_SOURCE = readSource("src/app/api/inngest/route.ts");

// Every step that runs transcription, note, flashcard, quiz or practice-test generation. The
// remaining step, "mark-lecture-failed", is the recording path itself: it is deliberately
// unbudgeted so it can still write the failure in the margin the budget leaves behind.
const BUDGETED_STEPS = [
  "transcribe-lecture",
  "generate-lecture-notes",
  "process-lecture-study",
  "process-lecture-quiz",
  "process-lecture-practice-test",
];

// The production failure, in the shape the platform log recorded it: POST /api/inngest ran for the
// full 300 seconds and was killed. A killed invocation reports nothing back — no rejection for the
// function's catch, no lecture id for Sentry — so the lecture kept its in-progress status and
// Inngest retried the same work three more times over the following twenty-five minutes.
test("a step that outlives the invocation rejects while the function can still record it", async () => {
  const budgetMs = getInvocationBudgetMs({ maxDurationSeconds: 300, elapsedMs: 0 });

  assert.equal(budgetMs, 300_000 - INVOCATION_BUDGET_SAFETY_MS);

  let recordedFailure = null;

  try {
    // Transcription that never finishes, exactly as the platform kill saw it. The tiny budget
    // stands in for the 280 seconds so the test does not have to wait them out.
    await runWithinInvocationBudget({
      run: () => new Promise(() => {}),
      budgetMs: 20,
      deadlineMessage: "Obdelava je trajala predolgo in se je ustavila. Poskusi znova.",
    });
  } catch (error) {
    // Stands in for markLecturePipelineFailed, which the killed invocation never reached.
    recordedFailure = error;
  }

  assert.ok(recordedFailure instanceof InvocationBudgetExceededError);
  assert.equal(
    recordedFailure.message,
    "Obdelava je trajala predolgo in se je ustavila. Poskusi znova.",
  );
});

test("every generation step runs inside the invocation budget", () => {
  const stepCalls = FUNCTIONS_SOURCE.split("step.run(").slice(1);

  for (const stepName of BUDGETED_STEPS) {
    const call = stepCalls.find((body) => body.startsWith(`"${stepName}"`));

    assert.ok(call, `no step.run("${stepName}") found in src/inngest/functions.ts`);
    assert.ok(
      call.includes("withStepBudget"),
      `step "${stepName}" runs unbudgeted, so the platform kill would discard its failure`,
    );
  }
});

test("checkpointed study generators retry budget-only failures", () => {
  for (const stepName of [
    "process-lecture-study",
    "process-lecture-quiz",
    "process-lecture-practice-test",
  ]) {
    const body = FUNCTIONS_SOURCE.split("step.run(")
      .slice(1)
      .find((candidate) => candidate.startsWith(`"${stepName}"`));

    assert.ok(body, `no step.run("${stepName}") found`);
    assert.match(
      body,
      /isBudgetOverrunFailure\(error\)[\s\S]*throw error/,
      `${stepName} would still swallow a resumable budget failure`,
    );
  }
});

test("the step budget is measured against the route's own maxDuration", () => {
  const routeMaxDuration = ROUTE_SOURCE.match(/export const maxDuration = (\d+)/);
  const budgetMaxDuration = FUNCTIONS_SOURCE.match(
    /const INNGEST_MAX_DURATION_SECONDS = (\d+)/,
  );

  assert.ok(routeMaxDuration, "src/app/api/inngest/route.ts no longer exports maxDuration");
  assert.ok(budgetMaxDuration, "src/inngest/functions.ts no longer declares its budget");
  // Next.js only accepts a literal for maxDuration, so the two cannot share a constant. A budget
  // measured against a stale limit is worse than none: it would either fire early on healthy work
  // or leave no margin at all.
  assert.equal(budgetMaxDuration[1], routeMaxDuration[1]);
});
