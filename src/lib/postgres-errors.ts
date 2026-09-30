// PostgREST reports a constraint failure as a plain object with a Postgres SQLSTATE in `code`,
// not as an Error subclass, so a caller that wants to tell "the row you referenced is gone" apart
// from "the database is broken" has to read that code.
//
// Kept as a leaf module with no imports so the exact error object production produced can be
// asserted in a test.

/** SQLSTATE 23503: insert or update violated a foreign key constraint. */
export const FOREIGN_KEY_VIOLATION_CODE = "23503";

/** SQLSTATE 42501: insufficient privilege, which is how a row-level security refusal arrives. */
export const INSUFFICIENT_PRIVILEGE_CODE = "42501";

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

/**
 * True when a write through the learner's own client was refused by a row-level security policy.
 * Policies that require the lecture to be the learner's (`exists (select 1 from lectures …)`) run
 * before the foreign key, so a write racing the note's deletion is refused here as 42501 and never
 * reaches the 23503 above. The code alone cannot say the note is gone — re-check before saying so.
 */
export function isRowLevelSecurityViolation(error: unknown) {
  return (
    readString(error, "code") === INSUFFICIENT_PRIVILEGE_CODE &&
    readString(error, "message").includes("row-level security")
  );
}
