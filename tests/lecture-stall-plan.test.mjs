import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SWEEP_RESUMES,
  STALL_RESUME_AFTER_MS,
  isNeverStartedDraft,
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
  hasTitle: true,
  accessTier: "paid",
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

/*
 * The empty-draft rule. The lecture row is inserted before its source exists, so an attempt that
 * dies in the seconds between the two leaves a row that never held anything — and failing one
 * hands the learner an untitled note saying an upload they may not remember starting did not
 * finish, with no retry button because there is nothing to retry.
 */

const emptyDraft = (overrides = {}) =>
  stalled({
    status: "uploading",
    processingMetadata: {},
    sourceType: "text",
    storagePath: null,
    hasTitle: false,
    hasTranscript: false,
    updatedAt: Date.parse(LONG_AGO),
    ...overrides,
  });

test("a draft nothing was ever attached to is deleted, not failed", () => {
  assert.deepEqual(planStalledLecture(emptyDraft()), {
    action: "discard",
    reason: "never-started",
  });
  assert.ok(isNeverStartedDraft(emptyDraft()));
});

test("a draft the learner put photos on is failed, so they hear about it", () => {
  const withPhotos = emptyDraft({
    processingMetadata: { pendingScanImages: [{ index: 0, path: "scans/1.jpg" }] },
  });

  assert.ok(!isNeverStartedDraft(withPhotos));
  assert.deepEqual(planStalledLecture(withPhotos), {
    action: "fail",
    reason: "upload-never-finished",
  });
});

test("anything the pipeline has already touched is never silently deleted", () => {
  // Each of these on its own is proof the row is more than bookkeeping.
  assert.ok(!isNeverStartedDraft(emptyDraft({ hasTitle: true })));
  assert.ok(!isNeverStartedDraft(emptyDraft({ storagePath: "lectures/a.m4a" })));
  assert.ok(!isNeverStartedDraft(emptyDraft({ hasTranscript: true })));
  assert.ok(!isNeverStartedDraft(emptyDraft({ hasArtifact: true })));
  assert.ok(
    !isNeverStartedDraft(emptyDraft({ processingMetadata: { manualImport: { text: "hello" } } })),
  );
  assert.ok(
    !isNeverStartedDraft(emptyDraft({ processingMetadata: { processing: { stage: "queued" } } })),
  );
});

test("an empty draft young enough to still be filling is left alone", () => {
  // The learner may be choosing photos this second. Nothing is deleted inside the stall window.
  assert.deepEqual(planStalledLecture(emptyDraft({ updatedAt: NOW - 5 * 60_000 })), {
    action: "wait",
    reason: "recent",
  });
});

test("a run that got past uploading is never deleted, however bare the row looks", () => {
  // It had a source once, whatever is left on the row now. The learner is owed a sentence.
  const bare = emptyDraft({ status: "generating_notes" });

  assert.ok(isNeverStartedDraft(bare), "guard: this row really is empty by every other measure");
  assert.deepEqual(planStalledLecture(bare), { action: "fail", reason: "no-source" });
});

test("a trial draft is failed rather than deleted, however empty", () => {
  /*
   * `profiles.trial_lecture_id` points at the row with `on delete set null` while
   * `trial_consumed_at` survives — so deleting one leaves a learner whose free note is spent and
   * whose free note does not exist, unable to create another. A dead note is the smaller harm.
   */
  const trial = emptyDraft({ accessTier: "trial" });

  assert.ok(isNeverStartedDraft(trial), "guard: empty by every measure except its tier");
  assert.deepEqual(planStalledLecture(trial), {
    action: "fail",
    reason: "upload-never-finished",
  });
});

test("a resumable run with empty metadata is still resumed, not discarded", () => {
  // `generating_notes` with a written transcript is the pipeline's own work in progress. It has
  // no source metadata left on the row, and deleting it would throw away a paid transcription.
  const resumable = emptyDraft({
    status: "generating_notes",
    hasTranscript: true,
  });

  assert.deepEqual(planStalledLecture(resumable), { action: "resume", job: "notes" });
});
