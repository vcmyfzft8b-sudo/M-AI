import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LECTURE_FAILURE_METADATA_KEY,
  canRetryLectureFailure,
  canRetryLectureFailureCode,
  readLectureFailureCode,
} from "../src/lib/lecture-failure-codes.ts";

test("retry is withheld only where the cause travels with the input", () => {
  // A link behind a sign-in redirects to the same login page every time, and a photo with no
  // readable text has no more text on the second pass.
  assert.equal(canRetryLectureFailureCode("link_requires_login"), false);
  assert.equal(canRetryLectureFailureCode("link_not_enough_text"), false);
  assert.equal(canRetryLectureFailureCode("unsupported_link_content_type"), false);
  assert.equal(canRetryLectureFailureCode("scan_not_enough_text"), false);
  assert.equal(canRetryLectureFailureCode("audio_no_clear_speech"), false);
});

test("transient failures keep the retry button", () => {
  // link_host_not_found is raised for EAI_AGAIN — a temporary resolver failure — as well as for
  // a domain that does not exist, and the two are indistinguishable here. Ambiguity keeps retry.
  assert.equal(canRetryLectureFailureCode("link_host_not_found"), true);
  assert.equal(canRetryLectureFailureCode("link_timeout"), true);
  assert.equal(canRetryLectureFailureCode("link_unreachable"), true);
  assert.equal(canRetryLectureFailureCode("link_not_loadable"), true);
});

test("an unknown or absent code stays retryable", () => {
  // The button disappears only where futility is established. Anything we cannot classify —
  // an AI failure, a code erased crossing an Inngest step boundary, a row written before codes
  // were recorded — keeps the offer.
  assert.equal(canRetryLectureFailureCode(null), true);
  assert.equal(canRetryLectureFailureCode(undefined), true);
  assert.equal(canRetryLectureFailureCode(""), true);
  assert.equal(canRetryLectureFailureCode("something_new_we_have_not_seen"), true);
});

test("reads the code the pipeline stamps into processing metadata", () => {
  const metadata = {
    processing: { stage: "failed" },
    [LECTURE_FAILURE_METADATA_KEY]: { code: "link_requires_login" },
  };

  assert.equal(readLectureFailureCode(metadata), "link_requires_login");
  assert.equal(canRetryLectureFailure({ processing_metadata: metadata }), false);
});

test("malformed or missing metadata never hides the button", () => {
  // Every one of these is a row we cannot read a verdict from, so every one must keep retry.
  for (const value of [null, undefined, "", 0, [], {}, { failure: null }, { failure: [] },
                       { failure: {} }, { failure: { code: 42 } }, { failure: { code: "" } }]) {
    assert.equal(readLectureFailureCode(value), null);
    assert.equal(canRetryLectureFailure({ processing_metadata: value }), true);
  }
});

test("a later failure with no code clears an earlier verdict", () => {
  // markLecturePipelineFailed writes the key on every failure, so this is what a row looks like
  // after an unclassified failure follows a classified one. It must read as retryable again,
  // not keep answering with the stale code.
  assert.equal(
    canRetryLectureFailure({
      processing_metadata: { [LECTURE_FAILURE_METADATA_KEY]: { code: null } },
    }),
    true,
  );
});

test("the verdict comes from a lecture row, not from a row read as metadata", () => {
  // The dashboard used to hand the whole row to canRetryLectureFailure. A row carries no
  // `failure` key of its own, so the code read as null and the "keep retry when unclassified"
  // default handed a working-looking button to every unretryable failure on that surface.
  // Passing the row is now the calling convention, so the mistake cannot come back.
  const failedLecture = {
    id: "9f0a2c1e-0000-4000-8000-000000000001",
    status: "failed",
    title: "Predavanje brez učne vsebine",
    error_message: "V gradivu ni učne vsebine.",
    processing_metadata: {
      processing: { stage: "failed" },
      [LECTURE_FAILURE_METADATA_KEY]: { code: "source_no_study_content" },
    },
  };

  assert.equal(canRetryLectureFailure(failedLecture), false);

  // The shape of the old bug, kept explicit: read the row where metadata was wanted and the
  // code vanishes.
  assert.equal(readLectureFailureCode(failedLecture), null);
  assert.equal(readLectureFailureCode(failedLecture.processing_metadata), "source_no_study_content");
});

test("both surfaces that render a failure ask about the row", () => {
  // The two call sites disagreed once — the note page hid the button while the dashboard showed
  // it for the same note. Neither may go back to passing metadata.
  for (const path of ["src/components/home-dashboard.tsx", "src/components/lecture-workspace.tsx"]) {
    const source = readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

    assert.match(source, /canRetryLectureFailure\(/);
    assert.doesNotMatch(source, /canRetryLectureFailure\([^)]*\.processing_metadata\)/);
  }
});
