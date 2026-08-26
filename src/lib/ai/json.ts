import "server-only";

import { ThinkingLevel } from "@google/genai";
import { z } from "zod";

import { generateStructuredObjectWithGemini } from "@/lib/ai/gemini";
import {
  directModelId,
  generateStructuredObjectWithOpenRouter,
  isOpenRouterModel,
} from "@/lib/ai/openrouter";
import {
  applyOutputHeadroom,
  resolveStageModelConfig,
  resolveStageTimeoutMs,
  type AiStage,
} from "@/lib/ai/model-config";
import { isWorkAbortedError } from "@/lib/abort-context";
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

  const config = resolveStageModelConfig({
    stage: params.stage,
    env: process.env,
    fallbackModel: env.GEMINI_TEXT_MODEL,
  });

  const maxOutputTokens = applyOutputHeadroom(params.maxOutputTokens, config);
  const timeoutMs = resolveStageTimeoutMs(params.stage);
  const usageContext = {
    ...(params.usageContext ?? {}),
    stage: params.usageContext?.stage ?? params.stage,
  };

  /**
   * A stage may name a routed model ("or/google/gemini-3.7-flash") to buy the same weights at the
   * gateway's price — on 2026-08-23 that is half what Google charges for 3.7-flash, on the most
   * expensive call in the product.
   *
   * The gateway is one more thing that can be down, and a promotional rate is a thing that ends,
   * so a routed call that fails for any reason is retried once against the provider directly. A
   * learner's lecture is never worth failing to save a fraction of a cent, and the fallback also
   * means the day the promotion ends is a pricing decision rather than an outage.
   */
  if (isOpenRouterModel(config.model)) {
    const apiKey = env.OPENROUTER_API_KEY;

    if (apiKey) {
      try {
        return await generateStructuredObjectWithOpenRouter({
          schema: params.schema,
          instructions: params.instructions,
          input: params.input,
          model: config.model,
          apiKey,
          maxOutputTokens,
          thinkingLevel: config.thinkingLevel,
          ...(timeoutMs ? { timeoutMs } : {}),
          usageContext,
        });
      } catch (error) {
        // A budget abort is not a gateway failure: falling back would start a fresh full-price
        // call on an invocation that has already been told to stop.
        if (isWorkAbortedError(error)) {
          throw error;
        }

        console.warn(
          `OpenRouter call for ${config.model} failed, falling back to the direct provider.`,
          error,
        );
      }
    }
  }

  return generateStructuredObjectWithGemini({
    schema: params.schema,
    instructions: params.instructions,
    input: params.input,
    model: isOpenRouterModel(config.model) ? directModelId(config.model) : config.model,
    maxOutputTokens,
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(params.maxAttempts ? { maxAttempts: params.maxAttempts } : {}),
    ...(config.thinkingLevel
      ? {
          thinkingConfig: {
            thinkingLevel: SDK_THINKING_LEVELS[config.thinkingLevel],
          },
        }
      : {}),
    usageContext,
  });
}
