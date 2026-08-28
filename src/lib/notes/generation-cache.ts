import "server-only";

import type { z } from "zod";

import { AI_STAGE_MODEL_ENV_KEYS, resolveStageModelConfig, type AiStage } from "@/lib/ai/model-config";
import { getServerEnv } from "@/lib/server-env";
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
 * a write error means "not saved", never a failed generation. Entries hash the full model input
 * plus the stage's resolved model, so a prompt change, an edited source or a model switch
 * invalidates itself. Rows die with their lecture via the migration's cascade, and
 * {@link clearGenerationCache} removes them once the notes are finished, so the table only holds
 * lectures that are in flight or failed (where the rows make the next retry cheap).
 *
 * Lookups are always by exact key — never "everything for this stage". PostgREST silently caps
 * an unbounded select at db-max-rows (1000 by default), which on precisely the biggest lectures
 * would make already-paid-for windows look uncached.
 */

/** Keeps each PostgREST `in` filter well under URL-length limits. */
const CACHE_LOOKUP_CHUNK_SIZE = 80;

/**
 * The resolved model and thinking level for a stage, as a cache-key part. Without it, flipping a
 * stage to a different model via env would keep serving the old model's checkpointed outputs —
 * exactly the change the "stale keys stop matching" contract must cover.
 */
export function stageModelCacheKeyPart(stage: AiStage, modelOverride?: string) {
  const envKey = AI_STAGE_MODEL_ENV_KEYS[stage];
  const config = resolveStageModelConfig({
    stage,
    // Mirrors json.ts exactly: a caller-supplied override loses to an explicit env override, so
    // the key always names the model the call will actually run on.
    env: modelOverride
      ? { ...process.env, [envKey]: process.env[envKey] || modelOverride }
      : process.env,
    fallbackModel: getServerEnv().GEMINI_TEXT_MODEL,
  });

  return `${config.model}|${config.thinkingLevel ?? "none"}`;
}

export async function loadGenerationCacheEntries(params: {
  lectureId: string;
  stage: string;
  cacheKeys: string[];
}): Promise<Map<string, unknown>> {
  const keys = [...new Set(params.cacheKeys)];
  const entries = new Map<string, unknown>();

  try {
    const supabase = createSupabaseServiceRoleClient();
    const chunks: string[][] = [];

    for (let start = 0; start < keys.length; start += CACHE_LOOKUP_CHUNK_SIZE) {
      chunks.push(keys.slice(start, start + CACHE_LOOKUP_CHUNK_SIZE));
    }

    const results = await Promise.all(
      chunks.map((chunk) =>
        supabase
          .from("note_generation_cache")
          .select("cache_key, payload")
          .eq("lecture_id", params.lectureId)
          .eq("stage", params.stage)
          .in("cache_key", chunk),
      ),
    );

    for (const { data, error } of results) {
      if (error) {
        console.warn("Note generation cache lookup failed; regenerating instead.", error.message);
        continue;
      }

      for (const row of (data ?? []) as Array<{ cache_key: string; payload: unknown }>) {
        entries.set(row.cache_key, row.payload);
      }
    }
  } catch (error) {
    console.warn("Note generation cache lookup failed; regenerating instead.", error);
  }

  return entries;
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

/** Called once the notes are saved and the lecture is ready — the checkpoints have done their job. */
/**
 * Without a stage this clears everything for the lecture (the note pipeline's completion call).
 * With a stage it clears only that stage's checkpoints — the study generators use this so a
 * finished deck's batches stop replaying (a learner who regenerates expects fresh drafts, not a
 * cache hit) while a quiz still generating keeps its own checkpoints untouched.
 */
export async function clearGenerationCache(lectureId: string, stage?: string) {
  try {
    let query = createSupabaseServiceRoleClient()
      .from("note_generation_cache")
      .delete()
      .eq("lecture_id", lectureId);

    if (stage) {
      query = query.eq("stage", stage);
    }

    const { error } = await query;

    if (error) {
      console.warn("Note generation cache cleanup failed; rows stay until lecture delete.", error.message);
    }
  } catch (error) {
    console.warn("Note generation cache cleanup failed; rows stay until lecture delete.", error);
  }
}

/**
 * The one checkpointing shape every single-call stage uses: exact-key lookup, schema-validated
 * replay, generate on miss, save on success. Keeping it here rather than at each call site is
 * what keeps the key discipline (and any future change to it) in one place.
 */
export async function withGenerationCheckpoint<TSchema extends z.ZodTypeAny>(params: {
  lectureId: string | null | undefined;
  stage: string;
  cacheKey: string;
  schema: TSchema;
  generate: () => Promise<z.infer<TSchema>>;
}): Promise<z.infer<TSchema>> {
  if (!params.lectureId) {
    return params.generate();
  }

  const entries = await loadGenerationCacheEntries({
    lectureId: params.lectureId,
    stage: params.stage,
    cacheKeys: [params.cacheKey],
  });
  const cached = params.schema.safeParse(entries.get(params.cacheKey));

  if (cached.success) {
    return cached.data;
  }

  const value = await params.generate();

  await saveGenerationCacheEntry({
    lectureId: params.lectureId,
    stage: params.stage,
    cacheKey: params.cacheKey,
    payload: value,
  });

  return value;
}
