import "server-only";

import { hashNotesContent, selectUsableTutorPlan } from "@/lib/tutor/plan-cache";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { TutorLessonPlan } from "@/lib/ai/tutor-voice-prompt";
import { loadTutorGrounding, planTutorLesson } from "@/lib/tutor-voice";
import type { Json } from "@/lib/database.types";

/**
 * The running order, worked out when the note is written rather than when a session starts.
 *
 * The plan is the one part of the tutor that genuinely cannot be made fast. GLM takes 19 to 51
 * seconds over it — about 1,100 tokens at 20-60 tokens a second — and it stays on the job
 * because it covers 23 of the omrezja-sl fixture's 23 key facts where the model that writes the
 * spoken turns covers 9. A running order that omits a topic is one the walkthrough never
 * teaches, so this is not a place to trade quality for speed.
 *
 * Generated at session start those seconds hide behind the opening greeting, and only just: a
 * measured 40-second plan landed with six seconds to spare against 46 seconds of speech, and the
 * slow tail of the distribution does not fit at all. Generated when the note is, they are not
 * seconds anybody is in the room for.
 *
 * It is a cache, not a new source of truth. A miss regenerates on the spot, exactly as before,
 * so a lecture written before this existed — or one whose warm-up failed, or whose note has been
 * edited since — behaves the way it always did rather than failing. Those lectures also heal
 * themselves: `ensureTutorPlan` stores what it generates, so the wait happens at most once and
 * no backfill is needed.
 */

/** A plan is only good for the note it was planned from. Same guard `editable_notes_doc` uses. */
type CachedPlanRow = {
  tutor_plan: Json | null;
  tutor_plan_notes_hash: string | null;
  structured_notes_md: string;
};

/**
 * Whether a stored plan may be taught from, separated from the row it came out of so the decision
 * can be asserted on directly — it is the part that decides whether a learner is walked through
 * topics their note no longer contains.
 *
 * Null covers every way a plan can be unusable and they are deliberately not distinguished: no
 * plan, no hash, a plan for a note since edited, and one that no longer parses all mean the same
 * thing to a caller — generate a fresh one.
 */
export async function readCachedTutorPlan(lectureId: string): Promise<TutorLessonPlan | null> {
  const supabase = createSupabaseServiceRoleClient();
  /*
   * The error is deliberately not read, and that is what makes the deploy order safe. Vercel
   * ships the code and the migration workflow applies the columns, and for the minutes between
   * them this query asks for columns that do not exist yet: it comes back with no data, which
   * this treats as a miss and answers by generating the plan on the spot — exactly what every
   * session did before the cache existed.
   */
  const { data } = await supabase
    .from("lecture_artifacts")
    .select("tutor_plan, tutor_plan_notes_hash, structured_notes_md")
    .eq("lecture_id", lectureId)
    .maybeSingle();

  const row = (data ?? null) as CachedPlanRow | null;

  if (!row) {
    return null;
  }

  return selectUsableTutorPlan({
    plan: row.tutor_plan,
    notesHash: row.tutor_plan_notes_hash,
    notes: row.structured_notes_md ?? "",
  });
}

/** Stores a plan against the note it was planned from. Best-effort: a failure here costs a cache miss. */
async function writeCachedTutorPlan(params: {
  lectureId: string;
  plan: TutorLessonPlan;
  notes: string;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("lecture_artifacts")
    .update({
      tutor_plan: params.plan as unknown as Json,
      tutor_plan_notes_hash: hashNotesContent(params.notes),
      tutor_plan_generated_at: new Date().toISOString(),
    } as never)
    .eq("lecture_id", params.lectureId);

  if (error) {
    console.warn("[tutor] plan could not be cached", { lectureId: params.lectureId, error });
  }
}

/**
 * The plan for a lecture: the stored one when it is still good, a fresh one otherwise.
 *
 * `notes` is hashed from the same string `loadTutorGrounding` reads, which is the note truncated
 * to the tutor's own character cap — so the hash answers the question that actually matters,
 * which is whether the material the plan was made from has changed.
 */
export async function ensureTutorPlan(lectureId: string): Promise<TutorLessonPlan | null> {
  const cached = await readCachedTutorPlan(lectureId);

  if (cached) {
    return cached;
  }

  const grounding = await loadTutorGrounding(lectureId);

  if (!grounding || grounding.notes.trim().length === 0) {
    return null;
  }

  const plan = await planTutorLesson(grounding);
  await writeCachedTutorPlan({ lectureId, plan, notes: grounding.notes });

  return plan;
}

/**
 * Warms the plan after a note is written, for a session nobody has started yet.
 *
 * Best-effort in the strongest sense: it is called from the pipeline once the lecture is already
 * ready, and a learner whose warm-up failed simply waits for the plan the way every learner did
 * before this existed. Nothing about a finished note is at risk here, so nothing is raised.
 */
export async function warmTutorPlan(lectureId: string) {
  try {
    const plan = await ensureTutorPlan(lectureId);

    return Boolean(plan);
  } catch (error) {
    console.warn("[tutor] plan warm-up failed", { lectureId, error });

    return false;
  }
}
