import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AI_PROVIDER_SPEND_CAP_FAILURE_CODE } from "../src/lib/ai/errors.ts";
import { readLectureFailureCode } from "../src/lib/lecture-failure-codes.ts";
import {
  PROVIDER_OUTAGE_RETRY_METADATA_KEY,
  planProviderOutageRetry,
  readProviderOutageRetryAt,
  withProviderOutageRetryMark,
} from "../src/lib/provider-outage-plan.ts";

const capped = (metadata = {}, overrides = {}) => ({
  status: "failed",
  processingMetadata: { failure: { code: AI_PROVIDER_SPEND_CAP_FAILURE_CODE }, ...metadata },
  sourceType: "text",
  storagePath: null,
  hasTranscript: false,
  ...overrides,
});

test("only failed lectures recorded with the spend-cap code are retried", () => {
  assert.deepEqual(planProviderOutageRetry(capped({}, { status: "queued" })), {
    action: "skip",
    reason: "not-failed",
  });
  assert.deepEqual(
    planProviderOutageRetry(capped({ failure: { code: "ai_provider_overloaded" } })),
    { action: "skip", reason: "not-spend-cap" },
  );
  assert.deepEqual(planProviderOutageRetry(capped({ failure: { code: null } })), {
    action: "skip",
    reason: "not-spend-cap",
  });
});

test("a lecture is retried once, ever", () => {
  const marked = withProviderOutageRetryMark(capped().processingMetadata, "2026-10-20T15:00:00Z");
  // The retry it was given failed on the cap again: the code is back, and so is nothing else.
  const failedAgain = { ...marked, failure: { code: AI_PROVIDER_SPEND_CAP_FAILURE_CODE } };

  assert.deepEqual(planProviderOutageRetry(capped(failedAgain)), {
    action: "skip",
    reason: "already-retried",
  });
});

test("each shape the cap leaves resumes where the retry route would send it", () => {
  // Photos still to read: the scan job (the only reader is Gemini).
  assert.deepEqual(
    planProviderOutageRetry(
      capped({ pendingScanImages: [{ path: "u/l/scans/photo-000.png" }] }, { sourceType: "image" }),
    ),
    { action: "retry", job: "scan" },
  );
  // A PDF still to read: the document job.
  assert.deepEqual(
    planProviderOutageRetry(capped({ pendingDocument: { path: "u/l/doc.pdf" } }, { sourceType: "pdf" })),
    { action: "retry", job: "document" },
  );
  // Prepared text (MEMOAI-WEB-65 was a text note that failed on its embeddings): notes.
  assert.deepEqual(
    planProviderOutageRetry(capped({ manualImport: { text: "Celica je osnovna enota življenja." } })),
    { action: "retry", job: "notes" },
  );
  // A recording that never got its transcript: transcription.
  assert.deepEqual(
    planProviderOutageRetry(capped({}, { sourceType: "audio", storagePath: "u/l/a.m4a" })),
    { action: "retry", job: "audio" },
  );
  // A recording whose transcript is stored goes straight to its notes, not to Soniox again.
  assert.deepEqual(
    planProviderOutageRetry(
      capped({}, { sourceType: "audio", storagePath: "u/l/a.m4a", hasTranscript: true }),
    ),
    { action: "retry", job: "notes" },
  );
  // A scan whose photos were already read: the prepared text wins.
  assert.deepEqual(
    planProviderOutageRetry(
      capped({ pendingScanImages: [{ path: "p" }], manualImport: { text: "Prebrano besedilo." } }),
    ),
    { action: "retry", job: "notes" },
  );
});

test("a lecture with nothing to resume from is left for the learner", () => {
  assert.deepEqual(planProviderOutageRetry(capped()), { action: "skip", reason: "no-source" });
});

test("the mark requeues the row, clears the failure and keeps everything else", () => {
  const before = {
    failure: { code: AI_PROVIDER_SPEND_CAP_FAILURE_CODE },
    manualImport: { text: "Besedilo." },
    stallSweep: { resumes: 1, lastResumeAt: "2026-10-19T10:00:00Z" },
    processing: { stage: "failed", updatedAt: "2026-10-20T13:40:00Z", errorMessage: "x", extra: 1 },
  };
  const after = withProviderOutageRetryMark(before, "2026-10-20T15:00:00Z");

  assert.equal(readProviderOutageRetryAt(after), "2026-10-20T15:00:00Z");
  assert.equal(readLectureFailureCode(after), null, "the note screen stops showing the cap");
  assert.deepEqual(after.processing, {
    stage: "queued",
    updatedAt: "2026-10-20T15:00:00Z",
    errorMessage: null,
    extra: 1,
  });
  assert.deepEqual(after.manualImport, before.manualImport);
  assert.deepEqual(after.stallSweep, before.stallSweep);
  assert.equal(readProviderOutageRetryAt(before), null);
  assert.ok(PROVIDER_OUTAGE_RETRY_METADATA_KEY in after);
});

/*
 * The executor lives in the server-only sweep module, so these pin the two orderings that keep it
 * from billing in a loop: Gemini is asked before anything is retried, and the stamp is written
 * before the job exists.
 */
test("the sweep asks Gemini first and stamps before it enqueues", () => {
  const source = readFileSync(new URL("../src/lib/lecture-stall-sweep.ts", import.meta.url), "utf8");
  const recover = source.slice(source.indexOf("async function recoverFromProviderOutage"));
  const retry = source.slice(
    source.indexOf("async function retryAfterProviderOutage"),
    source.indexOf("async function recoverFromProviderOutage"),
  );

  assert.ok(recover.indexOf("await probeGemini()") > 0);
  assert.ok(recover.indexOf("await probeGemini()") < recover.indexOf("retryAfterProviderOutage("));
  assert.match(recover, /if \(!probe\.ok\) \{[\s\S]*?return outcome;/);
  assert.ok(retry.indexOf("withProviderOutageRetryMark") < retry.indexOf("await RESUME_JOBS[job]"));
  assert.match(retry, /\.eq\("status", "failed"\)/, "only a lecture that is still failed is requeued");
});
