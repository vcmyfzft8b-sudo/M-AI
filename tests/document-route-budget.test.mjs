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

const DOCUMENT_ROUTE_SOURCE = readSource("src/app/api/internal/lectures/document/route.ts");
const JOBS_SOURCE = readSource("src/lib/jobs.ts");

// The production failure: POST /api/internal/lectures/document ran the full 300 seconds and was
// killed with a 504. Because the route awaited the extraction before responding, the caller that
// was awaiting *its* response died too -- POST /api/lectures/pdf at 10:25:58 and the recovery GET
// on /api/lectures/[id] at 11:06:46 both logged a runtime timeout while reporting 200, the
// signature of an invocation killed after its response was already sent.
test("a document run that outlives the invocation rejects while the route can still record it", async () => {
  const budgetMs = getInvocationBudgetMs({ maxDurationSeconds: 300, elapsedMs: 0 });

  assert.equal(budgetMs, 300_000 - INVOCATION_BUDGET_SAFETY_MS);

  let recordedFailure = null;

  try {
    // Extraction that never finishes, exactly as the platform kill saw it. The tiny budget stands
    // in for the 280 seconds so the test does not have to wait them out.
    await runWithinInvocationBudget({
      run: () => new Promise(() => {}),
      budgetMs: 20,
      deadlineMessage: "Obdelava je trajala predolgo in se je ustavila. Poskusi znova.",
    });
  } catch (error) {
    // Stands in for markLecturePipelineFailed, which the killed invocation never reached, leaving
    // the lecture on an in-progress status and the learner on a spinner that never resolves.
    recordedFailure = error;
  }

  assert.ok(recordedFailure instanceof InvocationBudgetExceededError);
  assert.equal(
    recordedFailure.message,
    "Obdelava je trajala predolgo in se je ustavila. Poskusi znova.",
  );
});

test("the document route answers before it starts extracting", () => {
  assert.ok(
    DOCUMENT_ROUTE_SOURCE.includes("after(async () => {"),
    "the route awaits processStoredDocumentLecture inline, so it holds its caller's invocation open for the whole run",
  );

  const afterBody = DOCUMENT_ROUTE_SOURCE.split("after(async () => {")[1];

  assert.ok(
    afterBody.includes("processStoredDocumentLecture"),
    "the extraction no longer runs inside after(), so the response still waits on it",
  );
});

test("the document extraction runs inside the invocation budget", () => {
  const afterBody = DOCUMENT_ROUTE_SOURCE.split("after(async () => {")[1] ?? "";

  assert.ok(
    afterBody.includes("runWithinInvocationBudget"),
    "an unbudgeted extraction is killed silently by the platform, discarding its failure",
  );
  assert.ok(
    afterBody.includes("markLecturePipelineFailed"),
    "nothing records the overrun on the lecture row, so it keeps its in-progress status forever",
  );
});

test("the budget is measured against the route's own maxDuration", () => {
  const routeMaxDuration = DOCUMENT_ROUTE_SOURCE.match(/export const maxDuration = (\d+)/);

  assert.ok(routeMaxDuration, "the document route no longer exports maxDuration");
  // Next.js only accepts a literal for maxDuration, so the budget reads the exported binding
  // rather than repeating the number -- a budget measured against a stale limit would either fire
  // early on healthy work or leave no margin at all.
  assert.ok(
    /maxDurationSeconds:\s*maxDuration/.test(DOCUMENT_ROUTE_SOURCE),
    "the budget hardcodes a duration instead of reading the route's own maxDuration",
  );
});

// The caller only ever reads response.ok, which is what makes answering early safe: no caller is
// waiting on needsNotesGeneration, which the route hands to enqueueLectureNotesGeneration itself.
test("the internal job caller reads only the response status, never the body", () => {
  const enqueueBody = JOBS_SOURCE.split("async function enqueueInternalLectureJob(")[1].split(
    "\nasync function",
  )[0];

  assert.ok(enqueueBody.includes("if (!response.ok)"));
  assert.ok(
    !enqueueBody.includes("needsNotesGeneration"),
    "a caller that reads needsNotesGeneration would break when the route answers before extracting",
  );
});
