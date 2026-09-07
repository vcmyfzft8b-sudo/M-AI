import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_UPLOAD_ATTEMPTS,
  RETRY_DELAYS_MS,
  SignedUploadError,
  isRetryableUploadFailure,
  runWithUploadRetries,
} from "../src/lib/upload-retry-policy.ts";

/*
 * The failure these cover is the one that cost learners real work: ten photographed pages sent
 * one at a time, where a single dropped PUT used to throw away the whole set. Everything here is
 * about which failures deserve another go and which are a verdict.
 */

/** A retry harness that records the waits instead of serving them. */
function harness(outcomes, options = {}) {
  const waits = [];
  const retries = [];
  let calls = 0;

  const run = runWithUploadRetries({
    attempt: async () => {
      const outcome = outcomes[calls];
      calls += 1;

      if (outcome) {
        throw outcome;
      }
    },
    onRetry: (attempt, attempts) => retries.push([attempt, attempts]),
    wait: async (ms) => {
      waits.push(ms);
    },
    ...options,
  });

  return { run, waits, retries, calls: () => calls };
}

const dropped = () => new TypeError("Load failed");

test("a connection that drops mid-upload is tried again", async () => {
  const attempt = harness([dropped(), null]);

  await attempt.run;

  assert.equal(attempt.calls(), 2);
  assert.deepEqual(attempt.waits, [RETRY_DELAYS_MS[0]]);
});

test("the learner is told a retry is happening, and which one", async () => {
  const attempt = harness([dropped(), dropped(), null]);

  await attempt.run;

  assert.deepEqual(attempt.retries, [
    [2, DEFAULT_UPLOAD_ATTEMPTS],
    [3, DEFAULT_UPLOAD_ATTEMPTS],
  ]);
});

test("a connection that never comes back gives up after the last attempt", async () => {
  const attempt = harness([dropped(), dropped(), dropped(), null]);

  await assert.rejects(attempt.run, /Load failed/);
  assert.equal(attempt.calls(), DEFAULT_UPLOAD_ATTEMPTS);
  assert.deepEqual(attempt.waits, RETRY_DELAYS_MS);
});

test("a rejected request is not retried, because the answer will not change", async () => {
  const attempt = harness([new SignedUploadError("Invalid token", 403), null]);

  await assert.rejects(attempt.run, /Invalid token/);
  assert.equal(attempt.calls(), 1, "a 403 must fail on the spot rather than three times over");
});

test("a storage service having a bad minute is retried", async () => {
  const attempt = harness([new SignedUploadError("Bad gateway", 502), null]);

  await attempt.run;

  assert.equal(attempt.calls(), 2);
});

test("an upload the learner cancels mid-flight is not retried", async () => {
  const controller = new AbortController();
  let calls = 0;

  // The connection drops and the learner cancels in the same moment — the retryable failure must
  // lose to the cancel, or we keep pushing bytes at a note they have already walked away from.
  const run = runWithUploadRetries({
    attempt: async () => {
      calls += 1;
      controller.abort();
      throw dropped();
    },
    signal: controller.signal,
    wait: async () => {},
  });

  await assert.rejects(run, /Load failed/);
  assert.equal(calls, 1);
});

test("an already-cancelled upload never starts", async () => {
  const controller = new AbortController();
  controller.abort();
  const attempt = harness([null], { signal: controller.signal });

  await assert.rejects(attempt.run, { name: "AbortError" });
  assert.equal(attempt.calls(), 0);
});

test("the shapes a dropped phone connection actually arrives in are all retryable", () => {
  // iOS Safari, Chrome, and a timed-out request respectively.
  assert.ok(isRetryableUploadFailure(new TypeError("Load failed")));
  assert.ok(isRetryableUploadFailure(new TypeError("Failed to fetch")));
  assert.ok(isRetryableUploadFailure(new Error("The network connection was lost.")));
  assert.ok(isRetryableUploadFailure(new Error("Request timed out")));

  assert.ok(isRetryableUploadFailure(new SignedUploadError("Too many", 429)));
  assert.ok(isRetryableUploadFailure(new SignedUploadError("Down", 503)));

  assert.ok(!isRetryableUploadFailure(new SignedUploadError("Nope", 400)));
  assert.ok(!isRetryableUploadFailure(new SignedUploadError("Too big", 413)));
  assert.ok(!isRetryableUploadFailure(new Error("Something else entirely")));
  assert.ok(!isRetryableUploadFailure(new DOMException("Cancelled", "AbortError")));
});
