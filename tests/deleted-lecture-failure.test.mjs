import assert from "node:assert/strict";
import test from "node:test";

import {
  ExpectedLectureInputError,
  isDeletedLectureFailure,
  isMissingLectureRowError,
} from "../src/lib/lecture-processing-errors.ts";

// The exact object supabase-js hands back when `.single()` finds no row.
function missingRowError() {
  return {
    code: "PGRST116",
    details: "The result contains 0 rows",
    hint: null,
    message: "Cannot coerce the result to a single JSON object",
  };
}

test("the PostgREST no-row failure is recognised by its code", () => {
  assert.equal(isMissingLectureRowError(missingRowError()), true);
});

test("it is still recognised once Inngest has flattened it to a bare Error", () => {
  // Across a step boundary the PostgrestError is rebuilt as `{ name: "Error", message, stack }`:
  // the `code` is gone and the message is the only thing left to go on.
  const rebuilt = new Error("Cannot coerce the result to a single JSON object");
  rebuilt.name = "Error";

  assert.equal(isMissingLectureRowError(rebuilt), true);
});

test("anything else is not a missing row", () => {
  assert.equal(isMissingLectureRowError(new Error("Gemini exploded")), false);
  assert.equal(isMissingLectureRowError({ code: "PGRST301", message: "JWT expired" }), false);
  assert.equal(isMissingLectureRowError(new ExpectedLectureInputError("...", "no_speech")), false);
  assert.equal(isMissingLectureRowError(null), false);
  assert.equal(isMissingLectureRowError("a string"), false);
});

test("a stage that failed on a row that is gone is a deletion, not a defect", () => {
  assert.equal(
    isDeletedLectureFailure({
      error: missingRowError(),
      lectureRow: null,
      lectureLookupFailed: false,
    }),
    true,
  );
});

test("a lookup that itself failed proves nothing, so the failure is still reported", () => {
  // The empty result of a broken lookup must never be read as "the lecture is gone" — that would
  // silently swallow a real pipeline failure every time the database hiccupped.
  assert.equal(
    isDeletedLectureFailure({
      error: missingRowError(),
      lectureRow: null,
      lectureLookupFailed: true,
    }),
    false,
  );
});

test("a row that is still there means the failure was about something else", () => {
  assert.equal(
    isDeletedLectureFailure({
      error: missingRowError(),
      lectureRow: { user_id: "u1", source_type: "document" },
      lectureLookupFailed: false,
    }),
    false,
  );
});

test("a missing row with an unrelated error is odd enough to keep reporting", () => {
  assert.equal(
    isDeletedLectureFailure({
      error: new Error("Model returned empty text output."),
      lectureRow: null,
      lectureLookupFailed: false,
    }),
    false,
  );
});
