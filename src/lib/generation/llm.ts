import "server-only";

import type { z } from "zod";

import {
  generateStructuredObjectWithGemini,
  generateStructuredObjectWithGeminiFile,
} from "@/lib/ai/gemini";
import { resolveGenerationModel, type GenerationStage } from "@/lib/generation/models";

export type GenerationCallContext = {
  lectureId?: string | null;
  userId?: string | null;
};

/**
 * The single entry point the generation pipelines use for structured model calls. Threads the
 * stage-resolved model and a usage context through, so every call lands in `ai_usage_events`
 * attributed to its lecture and pipeline stage instead of the anonymous default.
 */
export async function generateObject<TSchema extends z.ZodTypeAny>(params: {
  stage: GenerationStage;
  schema: TSchema;
  instructions: string;
  input: string;
  maxOutputTokens?: number;
  maxAttempts?: number;
  context?: GenerationCallContext;
}) {
  return generateStructuredObjectWithGemini({
    schema: params.schema,
    instructions: params.instructions,
    input: params.input,
    model: resolveGenerationModel(params.stage),
    maxOutputTokens: params.maxOutputTokens,
    maxAttempts: params.maxAttempts,
    usageContext: {
      stage: params.stage,
      lectureId: params.context?.lectureId ?? null,
      userId: params.context?.userId ?? null,
    },
  });
}

export async function generateObjectFromFile<TSchema extends z.ZodTypeAny>(params: {
  stage: GenerationStage;
  schema: TSchema;
  instructions: string;
  file: File;
  maxOutputTokens?: number;
  context?: GenerationCallContext;
}) {
  return generateStructuredObjectWithGeminiFile({
    schema: params.schema,
    instructions: params.instructions,
    file: params.file,
    model: resolveGenerationModel(params.stage),
    maxOutputTokens: params.maxOutputTokens,
    usageContext: {
      stage: params.stage,
      lectureId: params.context?.lectureId ?? null,
      userId: params.context?.userId ?? null,
    },
  });
}
