import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  OPENROUTER_DEFAULT_TIMEOUT_MS,
  resolveAiAttemptTimeoutMs,
} from "../src/lib/ai/attempt-budget.ts";
import { GLM_TEXT_MODEL, resolveStageTimeoutMs } from "../src/lib/ai/model-config.ts";
import {
  INVOCATION_BUDGET_SAFETY_MS,
  getInvocationBudgetMs,
} from "../src/lib/invocation-budget.ts";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const CHAT_STREAM_ROUTE_SOURCE = readSource("src/app/api/lectures/[id]/chat/stream/route.ts");
const LIBRARY_CHAT_ROUTE_SOURCE = readSource("src/app/api/library-chat/route.ts");
const PIPELINE_SOURCE = readSource("src/lib/pipeline.ts");

const ROUTE_MAX_DURATION_MS = 300_000;
/* What one chat attempt is actually allowed now, as opposed to the gateway's default. */
const CHAT_ATTEMPT_MS = resolveStageTimeoutMs("chat", GLM_TEXT_MODEL);

// The production failure: POST /api/lectures/<id>/chat/stream answered 504 at 17:47:25 on
// 2026-09-16. The log line is the *handled* half of it -- "[chat] streaming failed, falling back
// to a plain call" with a TimeoutError (DOMException code 23) -- so the stream had already spent
// its own leash before the fallback it logged was even started.
test("a streamed chat answer and its fallback do not both fit in the route's invocation", () => {
  // No invocation budget on the route means no deadline in the abort context, which is what
  // `remainingBudgetMs: undefined` stands for here.
  const streamAttemptMs = resolveAiAttemptTimeoutMs({
    requestedTimeoutMs: OPENROUTER_DEFAULT_TIMEOUT_MS,
    remainingBudgetMs: undefined,
  });
  const fallbackAttemptMs = resolveAiAttemptTimeoutMs({
    requestedTimeoutMs: OPENROUTER_DEFAULT_TIMEOUT_MS,
    remainingBudgetMs: undefined,
  });

  assert.equal(streamAttemptMs, 180_000);
  assert.equal(fallbackAttemptMs, 180_000);
  assert.ok(
    streamAttemptMs + fallbackAttemptMs > ROUTE_MAX_DURATION_MS,
    "unbudgeted, the two attempts are sized to 360s and the platform kills the function at 300s",
  );
});

// With the budget installed the second attempt can see how much invocation is actually left.
test("the fallback is clamped to the invocation that remains once the stream has timed out", () => {
  const budgetMs = getInvocationBudgetMs({ maxDurationSeconds: 300, elapsedMs: 0 });

  assert.equal(budgetMs, ROUTE_MAX_DURATION_MS - INVOCATION_BUDGET_SAFETY_MS);

  const streamAttemptMs = resolveAiAttemptTimeoutMs({
    requestedTimeoutMs: CHAT_ATTEMPT_MS,
    remainingBudgetMs: budgetMs,
  });

  assert.equal(streamAttemptMs, CHAT_ATTEMPT_MS, "a healthy stream keeps its full leash");

  // The stream burned its whole leash before throwing the TimeoutError the route logged.
  const fallbackAttemptMs = resolveAiAttemptTimeoutMs({
    requestedTimeoutMs: CHAT_ATTEMPT_MS,
    remainingBudgetMs: budgetMs - streamAttemptMs,
  });

  assert.ok(
    streamAttemptMs + fallbackAttemptMs <= budgetMs,
    "both attempts now fit inside the budget, so the platform never has to kill the function",
  );
  assert.ok(
    streamAttemptMs + fallbackAttemptMs < ROUTE_MAX_DURATION_MS,
    "and inside the route's own maxDuration, so the learner cannot be answered with a 504",
  );
});

/*
 * The stage's own leash, which is the half of the fix the budget cannot do by itself. A budget
 * keeps the function alive; it does not stop a learner sitting in front of a chat panel for
 * three minutes waiting to be told it failed. Both attempts plus the direct-provider tier
 * underneath them have to fit, with the learner's patience — not the platform limit — deciding
 * the first number.
 */
test("a chat attempt is leashed in seconds, not in minutes", () => {
  assert.equal(CHAT_ATTEMPT_MS, 60_000);
  assert.ok(
    CHAT_ATTEMPT_MS < OPENROUTER_DEFAULT_TIMEOUT_MS,
    "chat back on the gateway default is a three-minute wait for a two-hundred-token answer",
  );

  const budgetMs = getInvocationBudgetMs({ maxDurationSeconds: 300, elapsedMs: 0 });

  assert.ok(
    CHAT_ATTEMPT_MS * 2 < budgetMs,
    "the streamed attempt and its fallback must both fit, with room for the tier under them",
  );
});

// The library chat is the same two-model-calls-deep shape on the same 300s route, and it ran
// without a budget until this was written.
test("the library chat route runs its answer inside an invocation budget too", () => {
  assert.ok(
    LIBRARY_CHAT_ROUTE_SOURCE.includes("runWithinInvocationBudget"),
    "without a budget the abort context has no deadline and every attempt sizes itself alone",
  );

  const budgetedBody = LIBRARY_CHAT_ROUTE_SOURCE.split("runWithinInvocationBudget({")[1] ?? "";

  assert.ok(
    budgetedBody.includes("answerLibraryChat"),
    "the budget no longer wraps the call that makes the model attempts",
  );
  assert.ok(
    /maxDurationSeconds:\s*maxDuration/.test(LIBRARY_CHAT_ROUTE_SOURCE),
    "the budget hardcodes a duration instead of reading the route's own maxDuration",
  );
});

test("the chat stream route runs the answer inside an invocation budget", () => {
  assert.ok(
    CHAT_STREAM_ROUTE_SOURCE.includes("runWithinInvocationBudget"),
    "without a budget the abort context has no deadline and every attempt sizes itself alone",
  );

  const budgetedBody = CHAT_STREAM_ROUTE_SOURCE.split("runWithinInvocationBudget({")[1] ?? "";

  assert.ok(
    budgetedBody.includes("answerLectureChat"),
    "the budget no longer wraps the call that makes the model attempts",
  );
});

test("the chat budget is measured against the route's own maxDuration", () => {
  const routeMaxDuration = CHAT_STREAM_ROUTE_SOURCE.match(/export const maxDuration = (\d+)/);

  assert.ok(routeMaxDuration, "the chat stream route no longer exports maxDuration");
  assert.equal(Number(routeMaxDuration[1]) * 1000, ROUTE_MAX_DURATION_MS);
  // Next.js only accepts a literal for maxDuration, so the budget reads the exported binding
  // rather than repeating the number: a budget measured against a stale limit would either fire
  // early on healthy work or leave no margin at all.
  assert.ok(
    /maxDurationSeconds:\s*maxDuration/.test(CHAT_STREAM_ROUTE_SOURCE),
    "the budget hardcodes a duration instead of reading the route's own maxDuration",
  );
});

// The reason the route needs a budget at all: the answer is two serial model calls, and the
// second one is started from a catch block that cannot know how long the first one took.
test("a failed chat stream still falls back to a full second call", () => {
  // Matched on the shape rather than on the exact line: this is here to catch the fallback
  // being removed, not to fail the day somebody wraps the expression differently.
  assert.match(
    PIPELINE_SOURCE.replace(/\s+/g, " "),
    /const answer = \(await streamChatAnswer\(call, params\.onDelta\)\) \?\? \(await generateStructuredObject\(call\)\);/,
    "the streamed attempt no longer falls back to generateStructuredObject in the same invocation",
  );
});
