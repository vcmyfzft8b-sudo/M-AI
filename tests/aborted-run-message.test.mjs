import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AI_PROCESSING_TOO_LONG_MESSAGE,
  AI_PROVIDER_OVERLOADED_MESSAGE,
  isAbortedWorkError,
  toUserFacingAiErrorMessage,
} from "../src/lib/ai/errors.ts";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

/**
 * The production event this file is about (Sentry MEMOAI-WEB-34, 2026-08-27T17:48:50Z): a 67,413
 * character document ran past its step budget, and the rejection that reached
 * markLecturePipelineFailed was the cancelled call's own, not the budget's. The learner's note was
 * stamped with `error_message: "This operation was aborted"` — English, and meaningless to them —
 * and it opened a Sentry issue separate from the budget family it belongs to.
 */
const NODE_ABORT_MESSAGE = "This operation was aborted";

function nodeAbortError() {
  // What `AbortController.prototype.abort()` rejects an in-flight call with under Node.
  return new DOMException(NODE_ABORT_MESSAGE, "AbortError");
}

function workAbortedError() {
  // src/lib/abort-context.ts
  const error = new Error("The invocation budget ran out; remaining work was cancelled.");
  error.name = "WorkAbortedError";
  return error;
}

/**
 * The second sentence `WorkAbortedError` is thrown with (src/lib/ai/gemini.ts, the attempt-timeout
 * clamp): the budget has not fired yet, there is simply too little of it left to start another
 * model call. Sentry MEMOAI-WEB-4T / issue 144291117, 2026-09-01T17:59:47Z — one learner, a text
 * lecture, the note-writing stage. It crossed an Inngest step boundary, so the name was gone and
 * only this sentence was left; the message test below did not match it, and the raw English string
 * was written to the lecture as the learner's error message instead of being auto-retried.
 */
function budgetNearlySpentError() {
  const error = new Error(
    "The invocation budget is nearly spent; not starting another model call.",
  );
  error.name = "WorkAbortedError";
  return error;
}

/** How the error arrives after Inngest rebuilds it: class gone, name flattened, message only. */
function acrossStepBoundary(error) {
  const rebuilt = new Error(error.message);
  rebuilt.name = "Error";
  return rebuilt;
}

test("a cancelled run is recognised by name", () => {
  assert.equal(isAbortedWorkError(nodeAbortError()), true);
  assert.equal(isAbortedWorkError(workAbortedError()), true);
  assert.equal(isAbortedWorkError(budgetNearlySpentError()), true);
});

test("it is still recognised once Inngest has flattened it", () => {
  // This is the shape that actually reached markLecturePipelineFailed in production — the name is
  // gone, so a name-only check would miss the very event this fixes.
  assert.equal(isAbortedWorkError(acrossStepBoundary(nodeAbortError())), true);
  assert.equal(isAbortedWorkError(acrossStepBoundary(workAbortedError())), true);
  assert.equal(isAbortedWorkError(acrossStepBoundary(budgetNearlySpentError())), true);
});

/**
 * The bug behind issue 144291117 was not this one sentence — it was that the message test knew
 * only one of `WorkAbortedError`'s two sentences, and nothing failed when the second was added.
 * So pin the class instead of the string: every sentence the code can actually throw has to
 * survive the flattening, including any added later.
 */
test("every sentence WorkAbortedError is thrown with survives the step boundary", () => {
  const sources = ["src/lib/abort-context.ts", "src/lib/ai/gemini.ts"]
    .map((path) => readSource(path))
    .join("\n");

  const messages = [
    // The class default, declared as a constructor parameter default.
    ...readSource("src/lib/abort-context.ts").matchAll(/constructor\(message = "([^"]+)"/g),
    // Every explicit message passed at a throw site.
    ...sources.matchAll(/new WorkAbortedError\(\s*"([^"]+)"/g),
  ].map((match) => match[1]);

  assert.ok(messages.length >= 2, `expected the default and at least one explicit message, got ${messages.length}`);

  for (const message of messages) {
    const flattened = new Error(message);
    flattened.name = "Error";

    assert.equal(isAbortedWorkError(flattened), true, message);
    assert.equal(toUserFacingAiErrorMessage(flattened), AI_PROCESSING_TOO_LONG_MESSAGE, message);
  }
});

test("nothing else is mistaken for a cancelled run", () => {
  for (const other of [
    new Error("Gemini exploded"),
    new Error("Model returned empty text output."),
    // Close in wording but a different failure: the request timed out on its own, it was not
    // cancelled by the budget.
    new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    { code: "PGRST116", message: "Cannot coerce the result to a single JSON object" },
    "a string",
    null,
    undefined,
  ]) {
    assert.equal(isAbortedWorkError(other), false, String(other));
  }
});

test("the learner gets the budget's own sentence, not Node's abort text", () => {
  // The exact regression: this returned "This operation was aborted" before the fix.
  assert.equal(toUserFacingAiErrorMessage(nodeAbortError()), AI_PROCESSING_TOO_LONG_MESSAGE);
  assert.equal(
    toUserFacingAiErrorMessage(acrossStepBoundary(nodeAbortError())),
    AI_PROCESSING_TOO_LONG_MESSAGE,
  );
  assert.equal(toUserFacingAiErrorMessage(workAbortedError()), AI_PROCESSING_TOO_LONG_MESSAGE);

  // Issue 144291117: this returned the raw English "The invocation budget is nearly spent; not
  // starting another model call." and stamped it on the learner's lecture.
  assert.equal(
    toUserFacingAiErrorMessage(acrossStepBoundary(budgetNearlySpentError())),
    AI_PROCESSING_TOO_LONG_MESSAGE,
  );
});

test("the mapping is idempotent and leaves other failures alone", () => {
  // The scan rescue path rethrows this function's own output as a fresh Error, so the same text
  // can arrive here twice.
  assert.equal(
    toUserFacingAiErrorMessage(new Error(AI_PROCESSING_TOO_LONG_MESSAGE)),
    AI_PROCESSING_TOO_LONG_MESSAGE,
  );

  // An overloaded provider is a different failure with a different sentence, and still gets it.
  assert.equal(
    toUserFacingAiErrorMessage(new Error("503 Service Unavailable")),
    AI_PROVIDER_OVERLOADED_MESSAGE,
  );

  // An ordinary error is still passed through unchanged.
  assert.equal(toUserFacingAiErrorMessage(new Error("Transcript is empty.")), "Transcript is empty.");
});

test("every budget call site still uses the exact sentence exported here", () => {
  // The sentence is declared literally in five modules that this dependency-free file cannot
  // import. If any of them is reworded, the abort mapping above would quietly start producing a
  // different message from the budget it is meant to match — so pin them together.
  const callSites = [
    "src/inngest/functions.ts",
    "src/app/api/internal/lectures/document/route.ts",
    "src/app/api/internal/lectures/link/route.ts",
    "src/app/api/internal/lectures/scan/route.ts",
    "src/app/api/internal/lectures/process/route.ts",
  ];

  for (const path of callSites) {
    const declaration = readSource(path).match(/BUDGET_MESSAGE\s*=\s*"([^"]+)"/);

    assert.ok(declaration, `${path} should declare a budget message`);
    assert.equal(declaration[1], AI_PROCESSING_TOO_LONG_MESSAGE, path);
  }
});

test("recording a failure never throws on an odd error value", () => {
  // getErrorText fed `.toLowerCase()`/`.trim()` the result of JSON.stringify, which is `undefined`
  // for `undefined` — so this threw before the fix, inside the very handler whose job is to record
  // a failure. markLecturePipelineFailed calls it on whatever a catch happened to receive.
  for (const odd of [undefined, null, 0, false, "", {}, [], Symbol("x")]) {
    assert.doesNotThrow(() => toUserFacingAiErrorMessage(odd), String(odd));
    assert.equal(typeof toUserFacingAiErrorMessage(odd), "string");
    assert.doesNotThrow(() => isAbortedWorkError(odd), String(odd));
  }
});
