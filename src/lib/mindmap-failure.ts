/**
 * Turning whatever was thrown into a line worth putting on a screen.
 *
 * Separate from `mindmap.ts`, which is `server-only` and so cannot be loaded by the test runner —
 * and this is worth a test. Postgrest returns a plain object rather than an `Error`, so an
 * `instanceof Error` check silently misses every database failure and hands the learner the
 * fallback. Production showed exactly that when `lecture_mindmap_assets` was missing: the screen
 * said "Unknown mindmap generation error." while the error object it was holding said
 * `relation "public.lecture_mindmap_assets" does not exist`.
 */

const UNKNOWN = "Unknown mindmap generation error.";

export function describeMindmapFailure(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const message = typeof record?.message === "string" ? record.message.trim() : "";

  if (!message) {
    return UNKNOWN;
  }

  /* The Postgres code is what makes a message searchable, so it travels with it. */
  const code = typeof record?.code === "string" ? record.code.trim() : "";

  return code ? `${message} (${code})` : message;
}
