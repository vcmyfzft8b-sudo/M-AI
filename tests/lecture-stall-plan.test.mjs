import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SWEEP_RESUMES,
  STALL_RESUME_AFTER_MS,
  planResumeJob,
  planStalledLecture,
  readProcessingUpdatedAt,
  readStallSweepCount,
  withStallSweepMark,
} from "../src/lib/lecture-stall-plan.ts";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const LONG_AGO = new Date(NOW - STALL_RESUME_AFTER_MS - 60_000).toISOString();

const stalled = (overrides = {}) => ({
  status: "generating_notes",
  processingMetadata: { processing: { updatedAt: LONG_AGO } },
  sourceType: "audio",
  storagePath: "lectures/a.m4a",
  hasArtifact: false,
  hasTranscript: true,
  updatedAt: Date.parse(LONG_AGO),
  now: NOW,
  ...overrides,
});

test("a run that could still be alive is left alone", () => {
  const justNow = new Date(NOW - 5 * 60_000).toISOString();

  assert.deepEqual(
    planStalledLecture(stalled({ updatedAt: Date.parse(justNow) })),
    { action: "wait", reason: "recent" },
  );
});

test("a lecture whose notes already exist is reconciliation's problem, not the sweep's", () => {
  assert.deepEqual(planStalledLecture(stalled({ hasArtifact: true })), {
    action: "wait",
    reason: "settled",
  });
  assert.deepEqual(planStalledLecture(stalled({ status: "ready" })), {
    action: "wait",
    reason: "settled",
  });
});

test("a dead run with a written transcript resumes at note generation", () => {
  assert.deepEqual(planStalledLecture(stalled()), { action: "resume", job: "notes" });
});

test("the second stall fails instead of being paid for again", () => {
  const swept = stalled({
    processingMetadata: {
      processing: { updatedAt: LONG_AGO },
      stallSweep: { resumes: MAX_SWEEP_RESUMES, lastResumeAt: LONG_AGO },
    },
  });

  assert.deepEqual(planStalledLecture(swept), { action: "fail", reason: "already-resumed" });
});

test("an upload the browser never finished is failed, never resumed", () => {
  // The trap this guards: `pendingScanImages` is written when the signed upload URLs are issued,
  // so a lecture abandoned mid-upload looks perfectly resumable while its storage paths point at
  // nothing. Resuming one buys an OCR bill for files that were never uploaded.
  const abandoned = stalled({
    status: "uploading",
    sourceType: "text",
    storagePath: null,
    hasTranscript: false,
    processingMetadata: {
      processing: { updatedAt: LONG_AGO },
      pendingScanImages: [{ index: 0, path: "scans/never-arrived.jpg" }],
    },
  });

  assert.deepEqual(planStalledLecture(abandoned), {
    action: "fail",
    reason: "upload-never-finished",
  });
});

test("a dead run with nothing reusable on the row is failed, which costs nothing", () => {
  const empty = stalled({
    processingMetadata: { processing: { updatedAt: LONG_AGO } },
    sourceType: "link",
    storagePath: null,
    hasTranscript: false,
  });

  assert.deepEqual(planStalledLecture(empty), { action: "fail", reason: "no-source" });
});

test("resume picks the cheapest point that still exists, not the first one on the row", () => {
  // The document metadata that produced this transcript is still on the lecture. Re-running
  // extraction would pay a second time for text we already hold.
  const job = planResumeJob({
    processingMetadata: { pendingDocument: { path: "docs/a.pdf" } },
    sourceType: "document",
    storagePath: null,
    hasTranscript: true,
  });

  assert.equal(job, "notes");
});

test("source preparation resumes only for a lecture that never got that far", () => {
  const base = { sourceType: "document", storagePath: null, hasTranscript: false };

  assert.equal(
    planResumeJob({ ...base, processingMetadata: { pendingScanImages: ["a.jpg"] } }),
    "scan",
  );
  assert.equal(
    planResumeJob({ ...base, processingMetadata: { pendingDocument: { path: "a.pdf" } } }),
    "document",
  );
  assert.equal(
    planResumeJob({ ...base, processingMetadata: { pendingLinkUrl: "https://example.com" } }),
    "link",
  );
  assert.equal(
    planResumeJob({
      ...base,
      sourceType: "audio",
      storagePath: "lectures/a.m4a",
      processingMetadata: {},
    }),
    "audio",
  );
  assert.equal(planResumeJob({ ...base, processingMetadata: {} }), null);
});

test("prepared import text counts as a source even with no transcript rows", () => {
  assert.equal(
    planResumeJob({
      processingMetadata: { manualImport: { text: "  some pasted lecture text  " } },
      sourceType: "text",
      storagePath: null,
      hasTranscript: false,
    }),
    "notes",
  );

  assert.equal(
    planResumeJob({
      processingMetadata: { manualImport: { text: "   " } },
      sourceType: "text",
      storagePath: null,
      hasTranscript: false,
    }),
    null,
  );
});

test("the sweep mark accumulates and survives the rest of the metadata", () => {
  const marked = withStallSweepMark(
    { processing: { stage: "generating_notes" }, pendingLinkUrl: "https://example.com" },
    "2026-09-05T12:00:00Z",
  );

  assert.equal(marked.pendingLinkUrl, "https://example.com");
  assert.deepEqual(marked.processing, { stage: "generating_notes" });
  assert.equal(readStallSweepCount(marked), 1);
  assert.equal(readStallSweepCount(withStallSweepMark(marked, "2026-09-05T13:00:00Z")), 2);
});

test("a missing or malformed sweep count reads as never swept", () => {
  assert.equal(readStallSweepCount(null), 0);
  assert.equal(readStallSweepCount({}), 0);
  assert.equal(readStallSweepCount({ stallSweep: { resumes: "two" } }), 0);
  assert.equal(readStallSweepCount({ stallSweep: { resumes: -3 } }), 0);
});

test("the stage stamp wins over the row timestamp, which is only the fallback", () => {
  const stamped = "2026-09-05T11:00:00Z";
  const row = "2026-09-05T09:00:00Z";

  assert.equal(
    readProcessingUpdatedAt({ processing: { updatedAt: stamped } }, row),
    Date.parse(stamped),
  );
  // A rename moves `updated_at` without touching the stage stamp, so an unstamped row falls back.
  assert.equal(readProcessingUpdatedAt({}, row), Date.parse(row));
  assert.equal(readProcessingUpdatedAt({ processing: { updatedAt: "nonsense" } }, row), Date.parse(row));
  assert.equal(readProcessingUpdatedAt(null, "nonsense"), 0);
});
