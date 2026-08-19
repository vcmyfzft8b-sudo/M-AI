// PostgREST reports a constraint failure as a plain object with a Postgres SQLSTATE in `code`,
// not as an Error subclass, so a caller that wants to tell "the row you referenced is gone" apart
// from "the database is broken" has to read that code.
//
// Kept as a leaf module with no imports so the exact error object production produced can be
// asserted in a test.

/** SQLSTATE 23503: insert or update violated a foreign key constraint. */
export const FOREIGN_KEY_VIOLATION_CODE = "23503";

function readString(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return "";
  }

  const field = (value as Record<string, unknown>)[key];

  return typeof field === "string" ? field : "";
}

/**
 * True when a write failed because the lecture it points at no longer exists — the shape of a note
 * deleted while long-running work for it was still in flight. Every row keyed by `lecture_id`
 * cascades from `public.lectures`, so this is a deletion that won a race, not a bug in the write.
 */
export function isMissingLectureReferenceError(error: unknown) {
  if (readString(error, "code") !== FOREIGN_KEY_VIOLATION_CODE) {
    return false;
  }

  const details = readString(error, "details");
  const message = readString(error, "message");

  return (
    details.includes("(lecture_id)") ||
    message.includes("lecture_id_fkey") ||
    details.includes('table "lectures"')
  );
}
