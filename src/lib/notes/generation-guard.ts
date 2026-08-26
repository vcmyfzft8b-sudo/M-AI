import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Hard stop for a lecture whose generation has become a money loop.
 *
 * On 2026-08-25 one lecture bought 4,018 extraction calls and wrote its note fifteen times in two
 * hours: the step budget failed each run, Inngest retried, and the learner kept pressing retry on
 * top. The checkpoints make every retry after the first cheap, so a lecture that still manages to
 * burn through these ceilings inside a day is broken in a way another attempt will not fix — stop
 * it and say so, instead of letting it spend until someone reads the billing console.
 *
 * What the counters actually count is `ai_usage_events` rows, which are per model ATTEMPT — a
 * window that walks the whole retry ladder logs up to four rows — and the ceilings are sized for
 * that. The deck pipelines log their extraction under `study_extract`, so flashcards/quiz/
 * practice generation cannot charge this guard. Sized far above any legitimate day: the largest
 * admitted source extracts ~350 windows once (checkpointed afterwards) and even a heavy-retry
 * first run stays near ~500 rows; a healthy outline is one or two rows per run and outline
 * results are checkpointed; nobody rewrites one note ten times, and a write that keeps FAILING
 * (the one loop the success-count cannot see, since extraction and outline replay from
 * checkpoints and log nothing) is caught by the total-attempts ceiling.
 */
const GENERATION_GUARD_WINDOW_HOURS = 24;
const MAX_EXTRACTION_CALLS_PER_DAY = 1_200;
const MAX_OUTLINE_ATTEMPTS_PER_DAY = 60;
const MAX_COMPLETED_WRITES_PER_DAY = 10;
const MAX_WRITE_ATTEMPTS_PER_DAY = 20;

export const LECTURE_GENERATION_BUDGET_MESSAGE =
  "Ustvarjanje zapiskov za to gradivo je večkrat zapored spodletelo, zato smo nadaljnje poskuse ustavili. Poskusi jutri ali nam piši, da preverimo, kaj je narobe.";

export class LectureGenerationBudgetExceededError extends Error {
  constructor() {
    super(LECTURE_GENERATION_BUDGET_MESSAGE);
    this.name = "LectureGenerationBudgetExceededError";
  }
}

export function isLectureGenerationBudgetExceededError(error: unknown) {
  return (
    error instanceof LectureGenerationBudgetExceededError ||
    (error instanceof Error && error.name === "LectureGenerationBudgetExceededError")
  );
}

async function countUsageEvents(params: {
  lectureId: string;
  since: string;
  stage: string;
  successOnly?: boolean;
}) {
  let query = createSupabaseServiceRoleClient()
    .from("ai_usage_events")
    .select("*", { count: "exact", head: true })
    .eq("lecture_id", params.lectureId)
    .eq("stage", params.stage)
    .gte("created_at", params.since);

  if (params.successOnly) {
    query = query.eq("success", true);
  }

  const { count, error } = await query;

  if (error) {
    throw error;
  }

  return count ?? 0;
}

/** Throws {@link LectureGenerationBudgetExceededError} once a lecture's day is clearly a loop. */
export async function assertLectureGenerationWithinBudget(lectureId: string) {
  try {
    const since = new Date(
      Date.now() - GENERATION_GUARD_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const [extractionCalls, outlineAttempts, completedWrites, writeAttempts] = await Promise.all([
      countUsageEvents({ lectureId, since, stage: "note_extract" }),
      countUsageEvents({ lectureId, since, stage: "note_outline" }),
      countUsageEvents({ lectureId, since, stage: "note_write", successOnly: true }),
      countUsageEvents({ lectureId, since, stage: "note_write" }),
    ]);

    if (
      extractionCalls >= MAX_EXTRACTION_CALLS_PER_DAY ||
      outlineAttempts >= MAX_OUTLINE_ATTEMPTS_PER_DAY ||
      completedWrites >= MAX_COMPLETED_WRITES_PER_DAY ||
      writeAttempts >= MAX_WRITE_ATTEMPTS_PER_DAY
    ) {
      console.error("[lecture-pipeline] Generation budget exceeded; refusing another run", {
        lectureId,
        extractionCalls,
        outlineAttempts,
        completedWrites,
        writeAttempts,
      });

      throw new LectureGenerationBudgetExceededError();
    }
  } catch (error) {
    if (isLectureGenerationBudgetExceededError(error)) {
      throw error;
    }

    // The guard reads the usage meter; a broken meter must never block a learner's lecture.
    console.warn("Lecture generation guard could not read the usage meter; allowing the run.", error);
  }
}
