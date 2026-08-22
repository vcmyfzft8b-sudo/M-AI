import "server-only";

import { ThinkingLevel } from "@google/genai";
import { z } from "zod";

import { generateStructuredObjectWithGemini } from "@/lib/ai/gemini";
import {
  applyOutputHeadroom,
  resolveStageModelConfig,
  type AiStage,
} from "@/lib/ai/model-config";
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
      usageContext: params.usageContext,
    });
  }

  const config = resolveStageModelConfig({
    stage: params.stage,
    env: process.env,
    fallbackModel: env.GEMINI_TEXT_MODEL,
  });

  return generateStructuredObjectWithGemini({
    schema: params.schema,
    instructions: params.instructions,
    input: params.input,
    model: config.model,
    maxOutputTokens: applyOutputHeadroom(params.maxOutputTokens, config),
    ...(config.thinkingLevel
      ? {
          thinkingConfig: {
            thinkingLevel: SDK_THINKING_LEVELS[config.thinkingLevel],
          },
        }
      : {}),
    usageContext: {
      ...(params.usageContext ?? {}),
      stage: params.usageContext?.stage ?? params.stage,
    },
  });
}
