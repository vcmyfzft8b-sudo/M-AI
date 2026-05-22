import "server-only";

import { z } from "zod";

import { generateStructuredObjectWithGemini } from "@/lib/ai/gemini";
import type { GeminiUsageContext } from "@/lib/ai/usage-logging";
import { getServerEnv } from "@/lib/server-env";

export async function generateStructuredObject<TSchema extends z.ZodTypeAny>(params: {
  schema: TSchema;
  instructions: string;
  input: string;
  maxOutputTokens?: number;
  usageContext?: GeminiUsageContext;
  model?: string;
}) {
  const env = getServerEnv();
  const primaryModel = params.model ?? env.GEMINI_TEXT_MODEL;
  const request = {
    schema: params.schema,
    instructions: params.instructions,
    input: params.input,
    maxOutputTokens: params.maxOutputTokens,
    usageContext: params.usageContext,
  };

  try {
    return await generateStructuredObjectWithGemini({
      ...request,
      model: primaryModel,
    });
  } catch (error) {
    if (
      !env.GEMINI_TEXT_FALLBACK_MODEL ||
      env.GEMINI_TEXT_FALLBACK_MODEL === primaryModel
    ) {
      throw error;
    }

    return generateStructuredObjectWithGemini({
      ...request,
      model: env.GEMINI_TEXT_FALLBACK_MODEL,
      metadata: {
        fallbackFrom: primaryModel,
        fallbackReason: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
      },
    });
  }
}
