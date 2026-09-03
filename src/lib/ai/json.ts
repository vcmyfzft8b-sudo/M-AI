import "server-only";

import { ThinkingLevel } from "@google/genai";
import { z } from "zod";

import { generateStructuredObjectWithGemini } from "@/lib/ai/gemini";
import {
  AiAttemptBudgetUnavailableError,
  resolveOpenRouterTierTimeoutMs,
} from "@/lib/ai/attempt-budget";
import {
  directModelId,
  generateStructuredObjectWithOpenRouter,
  isOpenRouterModel,
  streamStructuredObjectWithOpenRouter,
} from "@/lib/ai/openrouter";
import {
  AI_STAGE_MODEL_ENV_KEYS,
  applyOutputHeadroom,
  isGeminiModel,
  resolveStageFallbackReserveMs,
  resolveStageFallbackModel,
  resolveStageModelConfig,
  resolveStageTimeoutMs,
  shouldFallBackToDirectProvider,
  supportsThinkingLevel,
  type AiStage,
} from "@/lib/ai/model-config";
import { isWorkAbortedError } from "@/lib/abort-context";
import { classifyGatewayFailure } from "@/lib/ai/structured-output";
import type { GeminiUsageContext } from "@/lib/ai/usage-logging";
import { getServerEnv } from "@/lib/server-env";

const SDK_THINKING_LEVELS = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
} as const;

/**
 * Structured generation with per-stage model selection. Each stage carries its own model and
 * thinking level (model-config.ts), overridable per stage via env, all falling back to
 * GEMINI_TEXT_MODEL. Callers that name no stage keep the old single-model behaviour.
 *
 * Thinking tokens are drawn from maxOutputTokens rather than billed beside it, so budgets are
 * widened by the stage's headroom whenever its thinking level can actually consume them —
 * otherwise a thinking model's first response reads as truncation and burns the retry ladder.
 */
export async function generateStructuredObject<TSchema extends z.ZodTypeAny>(params: {
  schema: TSchema;
  instructions: string;
  input: string;
  maxOutputTokens?: number;
  stage?: AiStage;
  /** For callers with their own fallback (e.g. condensation's mechanical selection): a retry ladder there is pure spend. */
  maxAttempts?: number;
  /**
   * Pins this one call to a model without touching the stage's configuration — the resolver
   * still supplies the stage's thinking level, headroom and timeout for whatever model this is.
   * Used by the outline's size gate (note-generation.ts): a very large outline cannot finish on
   * the slow default model inside one Vercel invocation, so it runs on the fast proven one. An
   * explicit env override for the stage still wins over this, so the operator keeps the last word.
   */
  modelOverride?: string;
  usageContext?: GeminiUsageContext;
}) {
  const env = getServerEnv();

  if (!params.stage) {
    return generateStructuredObjectWithGemini({
      schema: params.schema,
      instructions: params.instructions,
      input: params.input,
      model: env.GEMINI_TEXT_MODEL,
      maxOutputTokens: params.maxOutputTokens,
      ...(params.maxAttempts ? { maxAttempts: params.maxAttempts } : {}),
      usageContext: params.usageContext,
    });
  }

  const stageModelEnvKey = AI_STAGE_MODEL_ENV_KEYS[params.stage];
  const config = resolveStageModelConfig({
    stage: params.stage,
    env: params.modelOverride
      ? { ...process.env, [stageModelEnvKey]: process.env[stageModelEnvKey] || params.modelOverride }
      : process.env,
    fallbackModel: env.GEMINI_TEXT_MODEL,
  });

  const maxOutputTokens = applyOutputHeadroom(params.maxOutputTokens, config);
  const usageContext = {
    ...(params.usageContext ?? {}),
    stage: params.usageContext?.stage ?? params.stage,
  };

  /**
   * The fallback chain, one gateway wide and one provider deep (2026-08-29):
   *
   *   1. the stage's model, routed        (GLM through OpenRouter)
   *   2. the stage's Gemini fallback, routed  (same prompts, same gateway, same bill)
   *   3. the same Gemini, bought direct from Google
   *
   * Tier 2 exists because most failures are the MODEL's — a truncation, a refused schema, a bad
   * host — and the recovery should stay on the one gateway everything is billed and observed
   * through. Tier 3 exists because the gateway itself can be down, and a fallback that shares
   * the primary's gateway shares its outages. Every tier gets the identical instructions and
   * input; only the model id and wire settings change, so a learner cannot tell which tier
   * answered.
   */
  const routedFallbackModel = !isOpenRouterModel(config.model)
    ? null
    : isGeminiModel(config.model)
      ? null
      : (resolveStageFallbackModel(params.stage) ??
        (isGeminiModel(env.GEMINI_TEXT_MODEL) ? `or/google/${env.GEMINI_TEXT_MODEL}` : null));

  if (isOpenRouterModel(config.model)) {
    const apiKey = env.OPENROUTER_API_KEY;

    if (apiKey) {
      const routedAttempts =
        routedFallbackModel && routedFallbackModel !== config.model
          ? [config.model, routedFallbackModel]
          : [config.model];

      for (const [tierIndex, routedModel] of routedAttempts.entries()) {
        const attemptThinkingLevel = supportsThinkingLevel(routedModel)
          ? config.thinkingLevel
          : null;
        const attemptTimeoutMs = resolveOpenRouterTierTimeoutMs({
          stageTimeoutMs: resolveStageTimeoutMs(params.stage, routedModel),
          tierIndex,
        });
        // The primary model gets a second try before the chain moves on: its characteristic
        // failure (truncation) is a stochastic tail event that a retry usually clears, it fails
        // fast enough to leave room in the invocation, and the fallback tier costs 1.3-7x more
        // per token. A timeout gets no retry — it already burned the whole leash — and the
        // fallback tier gets no retry either: its job is to answer, not to be persisted with.
        const maxAttempts = tierIndex === 0 ? 2 : 1;
        let attemptMaxOutputTokens = maxOutputTokens;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          try {
            return await generateStructuredObjectWithOpenRouter({
              schema: params.schema,
              instructions: params.instructions,
              input: params.input,
              model: routedModel,
              apiKey,
              maxOutputTokens: attemptMaxOutputTokens,
              thinkingLevel: attemptThinkingLevel,
              providerSort: config.providerSort,
              timeoutMs: attemptTimeoutMs,
              fallbackReserveMs: resolveStageFallbackReserveMs(params.stage, routedModel),
              usageContext,
            });
          } catch (error) {
            // This tier was skipped before making a paid request because it would consume the
            // time reserved for its fallback. Move down the ladder immediately; retrying the
            // skipped tier cannot create more wall clock.
            if (error instanceof AiAttemptBudgetUnavailableError) {
              console.warn(
                `Skipping OpenRouter call for ${routedModel}; the invocation budget is reserved for its fallback.`,
              );
              break;
            }

            // A budget abort is not a gateway failure: falling back would start a fresh
            // full-price call on an invocation that has already been told to stop.
            if (!shouldFallBackToDirectProvider(error, isWorkAbortedError)) {
              throw error;
            }

            const failure = classifyGatewayFailure(error);

            if (failure === "truncated" && attemptMaxOutputTokens) {
              // A truncation retry without a bigger budget re-buys the same truncation.
              attemptMaxOutputTokens = Math.min(
                65_536,
                Math.round(attemptMaxOutputTokens * 1.8),
              );
            }

            console.warn(
              `OpenRouter call for ${routedModel} failed (${failure}), ${
                failure !== "timeout" && attempt + 1 < maxAttempts
                  ? "retrying on the same model"
                  : "falling back to the next tier"
              }.`,
              error,
            );

            if (failure === "timeout") {
              break;
            }
          }
        }
      }
    }
  }

  /**
   * The last tier: the fallback Gemini bought directly from Google. Stripping a routed Gemini id
   * gives the same weights; a routed non-Gemini primary strips through its stage's Gemini
   * fallback instead — sending "glm-5.3-flash" to the Gemini API is a guaranteed failure.
   */
  const fallbackModel = !isOpenRouterModel(config.model)
    ? config.model
    : isGeminiModel(config.model)
      ? directModelId(config.model)
      : routedFallbackModel
        ? directModelId(routedFallbackModel)
        : env.GEMINI_TEXT_MODEL;
  const fallbackThinkingLevel = supportsThinkingLevel(fallbackModel) ? config.thinkingLevel : null;
  const fallbackTimeoutMs = resolveStageTimeoutMs(params.stage, fallbackModel);

  return generateStructuredObjectWithGemini({
    schema: params.schema,
    instructions: params.instructions,
    input: params.input,
    model: fallbackModel,
    maxOutputTokens,
    ...(fallbackTimeoutMs ? { timeoutMs: fallbackTimeoutMs } : {}),
    ...(params.maxAttempts ? { maxAttempts: params.maxAttempts } : {}),
    ...(fallbackThinkingLevel
      ? {
          thinkingConfig: {
            thinkingLevel: SDK_THINKING_LEVELS[fallbackThinkingLevel],
          },
        }
      : {}),
    usageContext,
  });
}

/**
 * A streamed structured call for the one stage a learner watches happen.
 *
 * It runs only the routed tier: streaming is a nicety, and a stage that has to
 * reach for its fallback has bigger problems than how the text arrives. The
 * caller is expected to catch and re-run the ordinary
 * `generateStructuredObject`, which still has the full three-tier chain.
 * Returns null when the stage is not routed through the gateway at all, so the
 * caller can go straight to that path without an exception.
 */
export async function streamStructuredObject<TSchema extends z.ZodTypeAny>(params: {
  schema: TSchema;
  instructions: string;
  input: string;
  stage: AiStage;
  streamField: string;
  onDelta: (text: string) => void;
  maxOutputTokens?: number;
  usageContext?: GeminiUsageContext;
}): Promise<z.infer<TSchema> | null> {
  const env = getServerEnv();
  const config = resolveStageModelConfig({
    stage: params.stage,
    env: process.env,
    fallbackModel: env.GEMINI_TEXT_MODEL,
  });

  const apiKey = env.OPENROUTER_API_KEY;

  if (!isOpenRouterModel(config.model) || !apiKey) {
    return null;
  }

  return streamStructuredObjectWithOpenRouter({
    schema: params.schema,
    instructions: params.instructions,
    input: params.input,
    model: config.model,
    apiKey,
    streamField: params.streamField,
    onDelta: params.onDelta,
    maxOutputTokens: applyOutputHeadroom(params.maxOutputTokens, config),
    thinkingLevel: config.thinkingLevel,
    providerSort: config.providerSort,
    timeoutMs: resolveStageTimeoutMs(params.stage, config.model),
    fallbackReserveMs: resolveStageFallbackReserveMs(params.stage, config.model),
    usageContext: {
      ...(params.usageContext ?? {}),
      stage: params.usageContext?.stage ?? params.stage,
    },
  });
}
