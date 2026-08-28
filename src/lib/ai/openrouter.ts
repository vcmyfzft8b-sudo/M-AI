import "server-only";

import { z } from "zod";

import { getCurrentAbortSignal } from "@/lib/abort-context";
import { isMandatoryReasoningModel, resolveWireReasoningEffort } from "@/lib/ai/model-config";
import { GeminiTruncatedOutputError } from "@/lib/ai/structured-output";
import { parseStructuredText } from "@/lib/ai/structured-output";
import type { GeminiUsageContext, GeminiUsageMetadata } from "@/lib/ai/usage-logging";
import { logGeminiUsageEvent } from "@/lib/ai/usage-logging";

/**
 * OpenRouter route for models we would otherwise buy direct.
 *
 * It exists for one reason: the same Gemini model can cost half as much through the gateway. On
 * 2026-08-23 gemini-3.7-flash was $0.375/$1.875 per million there against Google's own
 * $0.75/$3.75, and note writing is the single most expensive call in the product. Nothing about
 * the model changes — same weights, same prompts, same schemas — so the measurements that chose it
 * still hold.
 *
 * A gateway is also a second thing that can be down, and a promotional rate is a thing that ends.
 * Both are handled by the caller falling back to the direct provider rather than failing the
 * lecture (see json.ts), which is why this function throws plainly instead of retrying forever.
 */

/** "or/google/gemini-3.7-flash" is routed; "gemini-3.7-flash" is bought direct. */
export const OPEN_ROUTER_PREFIX = "or/";

export function isOpenRouterModel(model: string) {
  return model.startsWith(OPEN_ROUTER_PREFIX);
}

export function openRouterModelId(model: string) {
  return model.slice(OPEN_ROUTER_PREFIX.length);
}

/** The model as the direct provider knows it, for the fallback path. */
export function directModelId(model: string) {
  return openRouterModelId(model).replace(/^[a-z0-9-]+\//i, "");
}

const REASONING_EFFORT = new Set(["minimal", "low", "medium", "high"]);

/**
 * How this request asks the gateway to reason, which differs by what the model can do.
 *
 * A Gemini or GPT model takes our level names directly and may skip reasoning entirely. GLM
 * cannot: reasoning is mandatory on its endpoint ("reasoning: { enabled: false }" is rejected
 * with a 400), it only understands max/high/low, and an unrecognised effort silently buys its
 * default — which is "max", the most expensive setting on the card. So GLM levels are mapped to
 * the nearest supported effort and the reasoning text is excluded from the response body (it is
 * billed either way; there is no reason to ship it back).
 */
function buildReasoningBlock(routedModel: string, thinkingLevel: string | null | undefined) {
  if (isMandatoryReasoningModel(routedModel)) {
    const effort =
      resolveWireReasoningEffort(
        routedModel,
        thinkingLevel && REASONING_EFFORT.has(thinkingLevel)
          ? (thinkingLevel as "minimal" | "low" | "medium" | "high")
          : "low",
      ) ?? "low";

    return { reasoning: { effort, exclude: true } };
  }

  return thinkingLevel && REASONING_EFFORT.has(thinkingLevel)
    ? { reasoning: { effort: thinkingLevel } }
    : {};
}

/**
 * Provider routing preferences. GLM is served by fifteen third-party hosts at wildly different
 * speeds and quantizations; without a preference OpenRouter picks by price and the same request
 * can land anywhere. sort:"throughput" pins routing to the fastest live host (measured
 * 2026-08-28: it roughly doubled tokens/s over default routing) and require_parameters keeps the
 * request off any host that would silently drop response_format's strict JSON schema. Gemini
 * routed through the gateway is served by Google alone, so it needs neither.
 */
function buildProviderBlock(routedModel: string) {
  return isMandatoryReasoningModel(routedModel)
    ? { provider: { sort: "throughput", require_parameters: true } }
    : {};
}

// Strict structured outputs accept a subset of JSON Schema: objects must forbid extra properties
// and require every key, and the value constraints are rejected outright. Dropping them is what
// makes the schema loadable; the zod parse afterwards still enforces every one of them.
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "multipleOf",
  "default",
  "$schema",
]);

export function toStrictJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(toStrictJsonSchema);
  }

  if (node === null || typeof node !== "object") {
    return node;
  }

  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      continue;
    }

    output[key] = toStrictJsonSchema(value);
  }

  if (output.type === "object" && output.properties) {
    output.additionalProperties = false;
    output.required = Object.keys(output.properties as Record<string, unknown>);
  }

  return output;
}

type OpenRouterResponse = {
  error?: { message?: string };
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

/** Maps the gateway's usage block onto the shape the usage log already understands. */
function toUsageMetadata(usage: OpenRouterResponse["usage"]): GeminiUsageMetadata {
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const completion = usage?.completion_tokens ?? 0;

  return {
    promptTokenCount: usage?.prompt_tokens ?? 0,
    // Reasoning is reported inside completion_tokens, so it is subtracted out here to keep the
    // two columns meaning the same thing they mean for a direct Gemini call.
    candidatesTokenCount: Math.max(0, completion - reasoning),
    thoughtsTokenCount: reasoning,
    totalTokenCount: usage?.total_tokens ?? 0,
  };
}

export async function generateStructuredObjectWithOpenRouter<TSchema extends z.ZodTypeAny>(params: {
  schema: TSchema;
  instructions: string;
  input: string;
  model: string;
  apiKey: string;
  maxOutputTokens?: number;
  thinkingLevel?: string | null;
  timeoutMs?: number;
  usageContext?: GeminiUsageContext;
}): Promise<z.infer<TSchema>> {
  const routedModel = openRouterModelId(params.model);
  const responseSchema = z.toJSONSchema(params.schema);
  const maxOutputTokens = params.maxOutputTokens;
  let response: OpenRouterResponse | undefined;
  // The invocation budget's signal rides along with the request timeout, so a budget-killed
  // pipeline stops paying for this call instead of finishing it as a zombie.
  const budgetSignal = getCurrentAbortSignal();
  const timeoutSignal = AbortSignal.timeout(params.timeoutMs ?? 180_000);

  try {
    const raw = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      signal: budgetSignal ? AbortSignal.any([timeoutSignal, budgetSignal]) : timeoutSignal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: routedModel,
        messages: [
          { role: "system", content: params.instructions },
          {
            role: "user",
            content: `Return exactly one JSON object that matches this JSON schema:\n${JSON.stringify(
              responseSchema,
            )}\n\nSource input:\n${params.input}`,
          },
        ],
        ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "structured_output",
            strict: true,
            schema: toStrictJsonSchema(responseSchema),
          },
        },
        ...buildReasoningBlock(routedModel, params.thinkingLevel),
        ...buildProviderBlock(routedModel),
      }),
    });

    response = (await raw.json()) as OpenRouterResponse;

    if (response.error) {
      throw new Error(`OpenRouter ${routedModel}: ${response.error.message ?? "request failed"}`);
    }

    const choice = response.choices?.[0];
    const text = (choice?.message?.content ?? "").trim();

    if (!text) {
      if (choice?.finish_reason === "length" && maxOutputTokens) {
        throw new GeminiTruncatedOutputError(maxOutputTokens);
      }

      throw new Error(`OpenRouter ${routedModel} returned empty structured output.`);
    }

    const parsed = parseStructuredText(params.schema, text);

    await logGeminiUsageEvent({
      model: params.model,
      stage: params.usageContext?.stage ?? "openrouter_structured_text",
      attemptIndex: 0,
      success: true,
      context: params.usageContext,
      usageMetadata: toUsageMetadata(response.usage),
      metadata: { maxOutputTokens, gateway: "openrouter", routedModel },
    });

    return parsed;
  } catch (error) {
    await logGeminiUsageEvent({
      model: params.model,
      stage: params.usageContext?.stage ?? "openrouter_structured_text",
      attemptIndex: 0,
      success: false,
      context: params.usageContext,
      usageMetadata: toUsageMetadata(response?.usage),
      metadata: { maxOutputTokens, gateway: "openrouter", routedModel },
      error,
    });

    throw error;
  }
}
