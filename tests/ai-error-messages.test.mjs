import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_PROVIDER_OVERLOADED_MESSAGE,
  AI_SAVE_TIMEOUT_MESSAGE,
  isRetryableAiError,
  toUserFacingAiErrorMessage,
} from "../src/lib/ai/errors.ts";

// Provider errors arrive in English from the API. Translating what we show the learner must not
// change how we classify what the provider said.
test("provider keywords still classify exactly as before", () => {
  assert.equal(isRetryableAiError(new Error("503 Service Unavailable")), true);
  assert.equal(isRetryableAiError(new Error("The model is overloaded")), true);
  assert.equal(isRetryableAiError(new Error("RESOURCE_EXHAUSTED")), true);
  assert.equal(isRetryableAiError(new Error("deadline exceeded")), true);
  assert.equal(isRetryableAiError(new Error("canceling statement due to statement timeout")), false);
  assert.equal(isRetryableAiError(new Error("x is not a function")), false);
});

// The scan rescue path rethrows this function's output as a fresh Error, so our own wording can
// come back round as the input. The English "temporarily overloaded" answered "retryable" through
// the keyword it happened to contain; the Slovenian wording contains no such keyword, so the
// verdict is pinned explicitly rather than left to language accident.
test("our own overloaded message still classifies as retryable", () => {
  assert.equal(isRetryableAiError(new Error(AI_PROVIDER_OVERLOADED_MESSAGE)), true);
});

test("our own save-timeout message still classifies as NOT retryable", () => {
  // The English wording contained no provider keyword either, so this verdict is unchanged.
  assert.equal(isRetryableAiError(new Error(AI_SAVE_TIMEOUT_MESSAGE)), false);
});

test("mapping a provider failure yields the learner-facing sentence", () => {
  assert.equal(
    toUserFacingAiErrorMessage(new Error("canceling statement due to statement timeout")),
    AI_SAVE_TIMEOUT_MESSAGE,
  );
  assert.equal(
    toUserFacingAiErrorMessage(new Error("503 model overloaded")),
    AI_PROVIDER_OVERLOADED_MESSAGE,
  );
});

test("mapping is idempotent, so a rethrown message is not rewritten", () => {
  // Without the guard the second pass would match the save-timeout sentence against the
  // overloaded rule and silently swap one message for the other.
  assert.equal(
    toUserFacingAiErrorMessage(new Error(AI_SAVE_TIMEOUT_MESSAGE)),
    AI_SAVE_TIMEOUT_MESSAGE,
  );
  assert.equal(
    toUserFacingAiErrorMessage(new Error(AI_PROVIDER_OVERLOADED_MESSAGE)),
    AI_PROVIDER_OVERLOADED_MESSAGE,
  );
});

test("an expected input message passes through untouched", () => {
  const message = "Na tej strani ni dovolj berljivega besedila za zapiske.";
  assert.equal(toUserFacingAiErrorMessage(new Error(message)), message);
});

test("every learner-facing sentence is Slovenian", () => {
  for (const value of [AI_SAVE_TIMEOUT_MESSAGE, AI_PROVIDER_OVERLOADED_MESSAGE,
                       toUserFacingAiErrorMessage(null)]) {
    assert.match(value, /[a-zščž]/i);
    assert.ok(!/\b(the|please|error|note|provider)\b/i.test(value), value);
  }
});
