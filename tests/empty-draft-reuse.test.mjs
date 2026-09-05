import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_DRAFT_REUSE_WINDOW_MS,
  isReusableEmptyDraft,
} from "../src/lib/empty-draft-reuse.ts";

/*
 * Pressing "create note" twice must not leave a dead note behind. The row is inserted before the
 * source exists, so an attempt that dies in between leaves an empty one — and the learner's next
 * move is almost always to press again. Adopting the empty draft is what makes that idempotent.
 */

const NOW = Date.parse("2026-09-05T12:00:00Z");

const draft = (overrides = {}) => ({
  id: "lecture-1",
  status: "uploading",
  title: null,
  storage_path: null,
  source_type: "text",
  access_tier: "paid",
  processing_metadata: {},
  created_at: new Date(NOW - 30_000).toISOString(),
  ...overrides,
});

const asking = { sourceType: "text", accessTier: "paid", now: NOW };

test("the empty draft from a failed attempt is adopted by the next one", () => {
  assert.ok(isReusableEmptyDraft(draft(), asking));
});

test("a draft with work in it is never handed to a second attempt", () => {
  // Two attempts sharing an id would have the second overwrite the first — worse than the dead
  // note this exists to prevent. `pendingScanImages` is the dangerous one: it is written when the
  // upload URLs are issued, so it appears while the photos are still going up.
  assert.ok(
    !isReusableEmptyDraft(
      draft({ processing_metadata: { pendingScanImages: [{ index: 0 }] } }),
      asking,
    ),
  );
  assert.ok(!isReusableEmptyDraft(draft({ title: "Fotosinteza" }), asking));
  assert.ok(!isReusableEmptyDraft(draft({ storage_path: "lectures/a.m4a" }), asking));
});

test("only a draft still waiting for its source qualifies", () => {
  for (const status of ["queued", "transcribing", "generating_notes", "ready", "failed"]) {
    assert.ok(!isReusableEmptyDraft(draft({ status }), asking), status);
  }
});

test("a draft of a different kind is not the note being asked for", () => {
  assert.ok(!isReusableEmptyDraft(draft({ source_type: "pdf" }), asking));
  assert.ok(!isReusableEmptyDraft(draft({ source_type: "link" }), asking));
});

test("a trial draft is not adopted for a paid note, nor the other way round", () => {
  // The tier decides what the note costs the learner, so a mismatched row is not a substitute.
  assert.ok(!isReusableEmptyDraft(draft({ access_tier: "trial" }), asking));
  assert.ok(
    !isReusableEmptyDraft(draft(), { ...asking, accessTier: "trial" }),
  );
});

test("a draft older than the stall window is a different day, not a retry", () => {
  const stale = draft({
    created_at: new Date(NOW - EMPTY_DRAFT_REUSE_WINDOW_MS - 1_000).toISOString(),
  });

  assert.ok(!isReusableEmptyDraft(stale, asking));

  const inside = draft({
    created_at: new Date(NOW - EMPTY_DRAFT_REUSE_WINDOW_MS + 1_000).toISOString(),
  });

  assert.ok(isReusableEmptyDraft(inside, asking));
});

test("an unreadable timestamp is not treated as fresh", () => {
  assert.ok(!isReusableEmptyDraft(draft({ created_at: "nonsense" }), asking));
});
