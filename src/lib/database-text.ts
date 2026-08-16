// Postgres cannot store every string JavaScript can hold, and PostgREST rejects the whole
// write when we send one:
//   - U+0000 is illegal in `text` and in `jsonb`. The write fails with
//     "unsupported Unicode escape sequence" (detail: "\u0000 cannot be converted to text").
//   - A lone surrogate cannot be encoded as UTF-8, so the request body is not even valid
//     JSON to Postgres ("invalid input syntax for type json").
// Extracted document text carries both often enough: a PDF whose embedded font maps a glyph
// to nothing makes pdf.js emit U+0000 in `item.str`, and a truncated model response can end
// mid surrogate pair. Neither carries meaning, so strip them before anything derived from a
// document reaches Supabase.
//
// The `u` flag makes the class match code points, so a well-formed surrogate pair (emoji,
// rare CJK) is a single code point outside the range and survives untouched.
const UNSTORABLE_CHARACTERS = /[\u0000\uD800-\uDFFF]/gu;

export function stripUnstorableCharacters(value: string) {
  return value.replace(UNSTORABLE_CHARACTERS, "");
}

/**
 * Deep-clean a value on its way into a `jsonb` column. Strings and object keys are stripped;
 * everything else is passed through unchanged.
 */
export function sanitizeJsonForDatabase<T>(value: T): T {
  if (typeof value === "string") {
    return stripUnstorableCharacters(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonForDatabase(entry)) as T;
  }

  if (value === null || typeof value !== "object" || value instanceof Date) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      stripUnstorableCharacters(key),
      sanitizeJsonForDatabase(entry),
    ]),
  ) as T;
}
