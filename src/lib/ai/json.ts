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
}) {
  const env = getServerEnv();
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
      model: env.GEMINI_TEXT_MODEL,
    });
  } catch (error) {
    if (
      !env.GEMINI_TEXT_FALLBACK_MODEL ||
      env.GEMINI_TEXT_FALLBACK_MODEL === env.GEMINI_TEXT_MODEL
    ) {
      throw error;
    }

    return generateStructuredObjectWithGemini({
      ...request,
      model: env.GEMINI_TEXT_FALLBACK_MODEL,
      metadata: {
        fallbackFrom: env.GEMINI_TEXT_MODEL,
        fallbackReason: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
      },
    });
  }
}
