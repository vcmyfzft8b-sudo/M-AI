import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export { generationCacheKey } from "./generation-cache-key.ts";

/**
 * Checkpoints for the note-generation pipeline, keyed by a hash of each call's exact input.
 *
 * The pipeline runs inside one Inngest step with a ~5-minute budget, and a large source takes
 * longer than that: the step fails on the budget, Inngest retries, and before this cache every
 * retry re-bought the entire two-pass extraction (~200 Gemini calls per run — the 2026-08-25
 * cost spike was five lectures doing exactly that all evening). A retry that finds its window
 * already extracted skips the model call, so the second attempt spends seconds where the first
 * spent minutes and the run converges instead of burning.
 *
 * The cache is deliberately fail-open in both directions: a lookup error means "not cached" and
 * a write error means "not saved", never a failed generation. Entries hash the full model input,
 * so a prompt change or edited source invalidates itself; rows die with their lecture via the
 * migration's cascade.
 */

export async function loadGenerationCache(params: {
  lectureId: string;
  stage: string;
}): Promise<Map<string, unknown>> {
  try {
    const { data, error } = await createSupabaseServiceRoleClient()
      .from("note_generation_cache")
      .select("cache_key, payload")
      .eq("lecture_id", params.lectureId)
      .eq("stage", params.stage);

    if (error) {
      console.warn("Note generation cache lookup failed; regenerating instead.", error.message);
      return new Map();
    }

    return new Map(
      ((data ?? []) as Array<{ cache_key: string; payload: unknown }>).map((row) => [
        row.cache_key,
        row.payload,
      ]),
    );
  } catch (error) {
    console.warn("Note generation cache lookup failed; regenerating instead.", error);
    return new Map();
  }
}

export async function saveGenerationCacheEntry(params: {
  lectureId: string;
  stage: string;
  cacheKey: string;
  payload: unknown;
}) {
  try {
    const { error } = await createSupabaseServiceRoleClient()
      .from("note_generation_cache")
      .upsert(
        {
          lecture_id: params.lectureId,
          stage: params.stage,
          cache_key: params.cacheKey,
          payload: params.payload,
        } as never,
        { onConflict: "lecture_id,stage,cache_key" },
      );

    if (error) {
      console.warn("Note generation cache write failed; continuing without it.", error.message);
    }
  } catch (error) {
    console.warn("Note generation cache write failed; continuing without it.", error);
  }
}
