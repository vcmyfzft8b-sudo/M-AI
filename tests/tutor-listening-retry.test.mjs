import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LISTEN_RETRY_BUSY_MS,
  LISTEN_RETRY_CONNECTION_MS,
  listeningRetryMayRun,
  nextListeningRetryDelay,
} from "../src/lib/tutor/listening-retry.ts";

// MEMOAI-WEB-3Y: a recognizer that closed mid-walkthrough stayed closed until the learner
// paused and continued, or the half-hourly renewal — up to thirty minutes of a tutor asking
// questions it could not hear.
const mid = () => 0.5;

test("a dropped connection is retried quickly, four times", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((n) => nextListeningRetryDelay("connection", n, mid)), [1000, 3000, 9000, 27000, null]);
});

test("a full pool is retried slowly, for about four minutes", () => {
  const delays = [0, 1, 2, 3, 4, 5].map((n) => nextListeningRetryDelay("busy", n, mid));
  assert.deepEqual(delays, [20000, 40000, 60000, 60000, 60000, null]);
  assert.equal(LISTEN_RETRY_BUSY_MS.reduce((a, b) => a + b, 0), 240000);
});

test("a refusal, a denied or missing microphone is never retried", () => {
  for (const reason of ["refused", "denied", "unavailable"]) {
    assert.equal(nextListeningRetryDelay(reason, 0, mid), null, reason);
  }
});

test("jitter stays within ±20 %", () => {
  assert.equal(nextListeningRetryDelay("connection", 0, () => 0), 800);
  assert.equal(nextListeningRetryDelay("connection", 0, () => 0.999999), 1200);
  assert.equal(LISTEN_RETRY_CONNECTION_MS.length, 4);
});

test("only a running, visible walkthrough without a recognizer retries", () => {
  for (const phase of ["preparing", "thinking", "speaking", "listening"]) {
    assert.equal(listeningRetryMayRun({ phase, visible: true, listening: false }), true, phase);
  }
  for (const phase of ["idle", "paused", "finished"]) {
    assert.equal(listeningRetryMayRun({ phase, visible: true, listening: false }), false, phase);
  }
  assert.equal(listeningRetryMayRun({ phase: "speaking", visible: false, listening: false }), false);
  assert.equal(listeningRetryMayRun({ phase: "speaking", visible: true, listening: true }), false);
});

test("the session wires the retry in, and tears it down", () => {
  const tutor = readFileSync(new URL("../src/components/lecture-tutor.tsx", import.meta.url), "utf8");
  assert.match(tutor, /if \(!scheduleListeningRetry\("connection"\)\) \{\s*setError\(t\("tutor\.error\.connection"\)\);/);
  assert.match(tutor, /if \(!scheduleListeningRetry\("busy"\)\) \{\s*setError\(t\("tutor\.error\.listeningBusy"\)\);/);
  assert.match(tutor, /inputError\.reason === "refused"\) \{[\s\S]{0,200}setError\(t\("tutor\.error\.connection"\)\)/);
  const teardown = tutor.slice(tutor.indexOf("const teardown = useCallback"), tutor.indexOf("const teardown = useCallback") + 800);
  assert.match(teardown, /clearTimer\(listenRetryTimerRef\)/);
  const pause = tutor.slice(tutor.indexOf("function pause()"), tutor.indexOf("function pause()") + 300);
  assert.match(pause, /clearTimer\(listenRetryTimerRef\)/);
});
