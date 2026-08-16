import assert from "node:assert/strict";
import test from "node:test";

import {
  TTS_CHUNK_PENDING_RETRY_BUDGET_MS,
  applyTtsCreationQuotaExhausted,
  canCreateTtsChunk,
  getTtsChunkRetryDelayMs,
  isTtsChunkPendingFailure,
  shouldRetryTtsChunkRequest,
} from "../src/lib/note-tts-retry.ts";

// The two 503s the read-aloud chunk route returns when the audio is not ready yet. Both mean the
// work is still in flight upstream, so both must be retried rather than shown to the reader.
const PENDING = { code: "tts_generation_pending", status: 503 };
const PROVIDER_RATE_LIMITED = { code: "tts_provider_rate_limited", status: 503 };
// Returned when the daily audio allowance is gone. Retrying cannot help — it stays gone until
// midnight — so this has to fail through to the message that explains that.
const DAILY_LIMIT = { code: "tts_daily_limit_reached", status: 403 };

test("retries the pending answers the route gives while a chunk is still generating", () => {
  assert.equal(isTtsChunkPendingFailure(PENDING), true);
  assert.equal(isTtsChunkPendingFailure(PROVIDER_RATE_LIMITED), true);
  assert.equal(isTtsChunkPendingFailure({ status: 429 }), true);
});

test("does not retry failures that retrying cannot fix", () => {
  assert.equal(isTtsChunkPendingFailure(DAILY_LIMIT), false);
  assert.equal(isTtsChunkPendingFailure({ code: "unauthorized", status: 401 }), false);
  assert.equal(isTtsChunkPendingFailure({ status: 500 }), false);
  assert.equal(isTtsChunkPendingFailure({ status: 404 }), false);
  assert.equal(isTtsChunkPendingFailure(null), false);
  assert.equal(isTtsChunkPendingFailure(undefined), false);
});

test("keeps retrying a pending chunk until the budget runs out", () => {
  assert.equal(
    shouldRetryTtsChunkRequest({ failure: PENDING, elapsedMs: 0, cancelled: false }),
    true,
  );
  assert.equal(
    shouldRetryTtsChunkRequest({
      failure: PENDING,
      elapsedMs: TTS_CHUNK_PENDING_RETRY_BUDGET_MS - 1,
      cancelled: false,
    }),
    true,
  );
  assert.equal(
    shouldRetryTtsChunkRequest({
      failure: PENDING,
      elapsedMs: TTS_CHUNK_PENDING_RETRY_BUDGET_MS,
      cancelled: false,
    }),
    false,
  );
});

// Generation was measured at 90-119s in production, so a budget that did not outlast it would give
// up while the audio was still on its way — the exact failure this retry exists to prevent.
test("budget outlasts a full generation", () => {
  assert.ok(TTS_CHUNK_PENDING_RETRY_BUDGET_MS > 120_000);
});

test("stops retrying once playback has moved on", () => {
  assert.equal(
    shouldRetryTtsChunkRequest({ failure: PENDING, elapsedMs: 0, cancelled: true }),
    false,
  );
});

test("terminal failures are not retried even with budget left", () => {
  assert.equal(
    shouldRetryTtsChunkRequest({ failure: DAILY_LIMIT, elapsedMs: 0, cancelled: false }),
    false,
  );
});

test("backs off progressively so an instant rate limit is not hammered", () => {
  const delays = [0, 1, 2, 3, 4, 5].map(getTtsChunkRetryDelayMs);

  for (let index = 1; index < delays.length; index += 1) {
    assert.ok(delays[index] >= delays[index - 1], "delay must never shrink");
  }

  assert.ok(delays[0] >= 1_000, "first retry should not be immediate");
  assert.ok(Math.max(...delays) <= 8_000, "delay must stay bounded so retries keep up");
});

// Recording "the allowance is spent" used to hand back a new status object every time, and the
// prefetch effect keys off that object's identity. Each rejected request therefore re-armed the
// effect, which sent the next request: production logged one 403 every ~2.7s, for minutes, per
// reader. Returning the same object when nothing changed is what stops the loop.
test("recording an exhausted allowance twice does not produce a new object", () => {
  const spent = { remainingSeconds: 0, secondsUsed: 900, limitSeconds: 900 };

  assert.equal(applyTtsCreationQuotaExhausted(spent), spent);
  assert.equal(applyTtsCreationQuotaExhausted(applyTtsCreationQuotaExhausted(spent)), spent);
});

test("recording an exhausted allowance still zeroes an allowance that had time left", () => {
  const current = { remainingSeconds: 120, secondsUsed: 780, limitSeconds: 900 };
  const next = applyTtsCreationQuotaExhausted(current);

  assert.notEqual(next, current);
  assert.equal(next.remainingSeconds, 0);
  assert.equal(next.secondsUsed, 780, "unrelated fields must survive");
  assert.equal(current.remainingSeconds, 120, "must not mutate in place");
});

test("recording an exhausted allowance tolerates a status that has not loaded yet", () => {
  assert.equal(applyTtsCreationQuotaExhausted(null), null);
  assert.equal(applyTtsCreationQuotaExhausted(undefined), null);
});

// The prefetcher asks this before queueing, so that a spent allowance stops the buffer instead of
// being rediscovered through a 403 for every remaining chunk of the note.
test("a chunk is only worth requesting when the allowance can pay for it", () => {
  assert.equal(canCreateTtsChunk({ quota: { remainingSeconds: 60 }, estimatedSeconds: 30 }), true);
  assert.equal(canCreateTtsChunk({ quota: { remainingSeconds: 30 }, estimatedSeconds: 30 }), true);
  assert.equal(canCreateTtsChunk({ quota: { remainingSeconds: 29 }, estimatedSeconds: 30 }), false);
  assert.equal(canCreateTtsChunk({ quota: { remainingSeconds: 0 }, estimatedSeconds: 30 }), false);
});

test("a fractional chunk length is rounded up before it is charged against the allowance", () => {
  assert.equal(canCreateTtsChunk({ quota: { remainingSeconds: 30 }, estimatedSeconds: 30.4 }), false);
  // Even a chunk estimated at almost nothing costs a second, matching what the route reserves.
  assert.equal(canCreateTtsChunk({ quota: { remainingSeconds: 0 }, estimatedSeconds: 0.2 }), false);
  assert.equal(canCreateTtsChunk({ quota: { remainingSeconds: 1 }, estimatedSeconds: 0.2 }), true);
});

test("an unlimited or not-yet-loaded allowance never blocks a request", () => {
  assert.equal(
    canCreateTtsChunk({
      quota: { remainingSeconds: 0, hasUnlimitedUsage: true },
      estimatedSeconds: 300,
    }),
    true,
  );
  assert.equal(canCreateTtsChunk({ quota: null, estimatedSeconds: 300 }), true);
});

// The pending answer arrives after a ~24s server-side wait, so the retries themselves cost almost
// nothing; the budget has to survive enough of them to cover a generation.
test("enough retries fit in the budget to outlast a generation", () => {
  let elapsed = 0;
  let attempts = 0;

  while (
    shouldRetryTtsChunkRequest({ failure: PENDING, elapsedMs: elapsed, cancelled: false })
  ) {
    elapsed += 24_000 + getTtsChunkRetryDelayMs(attempts);
    attempts += 1;
  }

  assert.ok(attempts >= 4, `expected at least 4 attempts, got ${attempts}`);
  assert.ok(elapsed > 120_000, "retrying should outlast a 120s generation");
});
