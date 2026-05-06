import "server-only";

import { z } from "zod";

import { generateStructuredObjectWithDeepSeek } from "@/lib/ai/deepseek";
import { generateStructuredObjectWithGemini } from "@/lib/ai/gemini";
import type { AiUsageContext } from "@/lib/ai/usage-logging";
import { getServerEnv } from "@/lib/server-env";

export async function generateStructuredObject<TSchema extends z.ZodTypeAny>(params: {
  schema: TSchema;
  instructions: string;
  input: string;
  maxOutputTokens?: number;
  usageContext?: AiUsageContext;
}) {
  const env = getServerEnv();

  if (env.AI_GENERATION_PROVIDER === "deepseek") {
    try {
      return await generateStructuredObjectWithDeepSeek({
        schema: params.schema,
        instructions: params.instructions,
        input: params.input,
        model: env.DEEPSEEK_TEXT_MODEL,
        maxOutputTokens: params.maxOutputTokens,
        usageContext: params.usageContext,
      });
    } catch (error) {
      if (env.AI_GENERATION_FALLBACK_PROVIDER !== "gemini") {
        throw error;
      }

      console.warn("DeepSeek generation failed; falling back to Gemini.", error);
    }
  }

  return generateStructuredObjectWithGemini({
    schema: params.schema,
    instructions: params.instructions,
    input: params.input,
    model: env.GEMINI_TEXT_MODEL,
    maxOutputTokens: params.maxOutputTokens,
    usageContext: params.usageContext,
  });
}
