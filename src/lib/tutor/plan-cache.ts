// Relative imports and no "server-only": this is the rule that decides whether a learner is
// walked through a running order made for a note they have since rewritten, and that is worth
// asserting on directly rather than reproducing against a database.
import { createHash } from "node:crypto";

import { tutorLessonPlanSchema, type TutorLessonPlan } from "../ai/tutor-voice-prompt.ts";

/**
 * The fingerprint a stored plan is kept against.
 *
 * Deliberately the same function `editable_notes_doc` is guarded by (note-doc-server.ts
 * re-exports this one) — two hashes of the same note computed two different ways would be two
 * caches that expire at different moments.
 */
export function hashNotesContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Whether a stored running order may still be taught from.
 *
 * Null covers every way a plan can be unusable and they are deliberately not distinguished: no
 * plan, no fingerprint, a plan for a note since edited, and one that no longer parses all mean
 * the same thing to the caller — generate a fresh one, which is what every session did before
 * this cache existed.
 */
export function selectUsableTutorPlan(row: {
  plan: unknown;
  notesHash: string | null;
  notes: string;
}): TutorLessonPlan | null {
  if (!row.plan || !row.notesHash) {
    return null;
  }

  if (row.notesHash !== hashNotesContent(row.notes)) {
    /*
     * The note has been edited since the plan was made, and teaching from the old running order
     * would walk the learner through topics their note no longer contains. Nothing has to
     * invalidate this explicitly: every path that rewrites a note changes the hash, so an edit
     * anywhere expires the plan by itself.
     */
    return null;
  }

  /*
   * Parsed rather than trusted. The schema a plan was stored under can change beneath it, and one
   * that no longer satisfies it must not reach the prompt half-shaped — a cache is allowed to
   * miss, it is not allowed to hand back something malformed.
   */
  const parsed = tutorLessonPlanSchema.safeParse(row.plan);

  return parsed.success ? parsed.data : null;
}
