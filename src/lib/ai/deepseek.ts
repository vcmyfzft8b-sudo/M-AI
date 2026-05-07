import "server-only";

import { z } from "zod";

import { isRetryableAiError } from "@/lib/ai/errors";
import { logAiUsageEvent, type AiUsageContext, type GeminiUsageMetadata } from "@/lib/ai/usage-logging";
import { requireDeepSeekEnv } from "@/lib/server-env";

const DEEPSEEK_GENERATION_MAX_ATTEMPTS = 2;
const DEEPSEEK_GENERATION_TIMEOUT_MS = 45_000;
const DEEPSEEK_RETRY_BASE_DELAY_MS = 1_500;

type DeepSeekUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

type DeepSeekChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  usage?: DeepSeekUsage;
};

class DeepSeekApiError extends Error {
  code?: string | number;
  status?: number;

  constructor(message: string, params?: { code?: string | number; status?: number }) {
    super(message);
    this.name = "DeepSeekApiError";
    this.code = params?.code;
    this.status = params?.status;
  }
}

function stripCodeFences(value: string) {
  return value.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function extractJsonPayload(value: string) {
  const stripped = stripCodeFences(value);
  const objectStart = stripped.indexOf("{");
  const arrayStart = stripped.indexOf("[");
  const candidateStarts = [objectStart, arrayStart].filter((index) => index >= 0);

  if (candidateStarts.length === 0) {
    return stripped;
  }

  const start = Math.min(...candidateStarts);
  const openingChar = stripped[start];
  const closingChar = openingChar === "[" ? "]" : "}";
  const end = stripped.lastIndexOf(closingChar);

  if (end <= start) {
    return stripped.slice(start).trim();
  }

  return stripped.slice(start, end + 1).trim();
}

function parseStructuredText<TSchema extends z.ZodTypeAny>(schema: TSchema, text: string) {
  return schema.parse(JSON.parse(extractJsonPayload(text)));
}

function toErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveMaxAttempts(maxAttempts: number | undefined) {
  if (maxAttempts == null) {
    return DEEPSEEK_GENERATION_MAX_ATTEMPTS;
  }

  return Math.max(1, Math.min(DEEPSEEK_GENERATION_MAX_ATTEMPTS, Math.floor(maxAttempts)));
}

function toUsageMetadata(usage: DeepSeekUsage | undefined): GeminiUsageMetadata | null {
  if (!usage) {
    return null;
  }

  return {
    promptTokenCount: usage.prompt_tokens,
    candidatesTokenCount: usage.completion_tokens,
    totalTokenCount: usage.total_tokens,
  };
}

async function createDeepSeekChatCompletion(params: {
  model: string;
  apiKey: string;
  baseUrl: string;
  instructions: string;
  input: string;
  responseSchema: unknown;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}) {
  const response = await fetch(`${params.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        {
          role: "system",
          content:
            "You return strict JSON only. Do not include markdown fences, commentary, or prose outside the JSON object.",
        },
        {
          role: "user",
          content: `${params.instructions}

Return exactly one JSON object that matches this JSON schema:
${JSON.stringify(params.responseSchema)}

Source input:
${params.input}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: params.maxOutputTokens,
      temperature: 0.2,
      thinking: { type: "disabled" },
    }),
    signal: params.signal,
  });

  const responseText = await response.text();
  let payload: unknown = null;

  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorPayload = payload as { error?: { message?: unknown; code?: unknown; type?: unknown } } | null;
    const message =
      typeof errorPayload?.error?.message === "string"
        ? errorPayload.error.message
        : responseText || `DeepSeek request failed with HTTP ${response.status}.`;
    const code = errorPayload?.error?.code ?? errorPayload?.error?.type ?? response.status;

    throw new DeepSeekApiError(message, {
      code: typeof code === "string" || typeof code === "number" ? code : response.status,
      status: response.status,
    });
  }

  return payload as DeepSeekChatResponse;
}

async function logDeepSeekGenerationAttempt(params: {
  model: string;
  stage: string;
  attemptIndex: number;
  success: boolean;
  usageContext?: AiUsageContext;
  usageMetadata?: GeminiUsageMetadata | null;
  metadata?: Record<string, unknown>;
  error?: unknown;
}) {
  await logAiUsageEvent({
    provider: "deepseek",
    model: params.model,
    stage: params.usageContext?.stage ?? params.stage,
    attemptIndex: params.attemptIndex,
    success: params.success,
    usageMetadata: params.usageMetadata ?? null,
    context: params.usageContext,
    metadata: params.metadata,
    error: params.error,
  });
}

export async function generateStructuredObjectWithDeepSeek<TSchema extends z.ZodTypeAny>(params: {
  schema: TSchema;
  instructions: string;
  input: string;
  model?: string;
  maxOutputTokens?: number;
  maxAttempts?: number;
  usageContext?: AiUsageContext;
}) {
  const env = requireDeepSeekEnv();
  const model = params.model ?? env.DEEPSEEK_TEXT_MODEL;
  const responseSchema = z.toJSONSchema(params.schema);
  const maxAttempts = resolveMaxAttempts(params.maxAttempts);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryInstruction =
      attempt === 0 || !lastError
        ? ""
        : `\n\nPrevious attempt failed because the JSON was invalid: ${toErrorMessage(
            lastError,
          )}. Return exactly one valid JSON object matching the schema.`;
    const maxOutputTokens = params.maxOutputTokens
      ? Math.round(params.maxOutputTokens * (attempt === 0 ? 1 : 1 + attempt * 0.4))
      : undefined;
    let response: DeepSeekChatResponse | undefined;
    let usageMetadata: GeminiUsageMetadata | null = null;
    const controller = new AbortController();

    try {
      response = await withTimeout(
        createDeepSeekChatCompletion({
          model,
          apiKey: env.DEEPSEEK_API_KEY,
          baseUrl: env.DEEPSEEK_BASE_URL,
          instructions: `${params.instructions}${retryInstruction}`,
          input: params.input,
          responseSchema,
          maxOutputTokens,
          signal: controller.signal,
        }),
        DEEPSEEK_GENERATION_TIMEOUT_MS,
        "DeepSeek structured generation",
      );
      usageMetadata = toUsageMetadata(response.usage);

      const outputText = stripCodeFences(response.choices?.[0]?.message?.content ?? "");

      if (!outputText) {
        throw new Error("Model returned empty structured output.");
      }

      const parsed = parseStructuredText(params.schema, outputText);

      await logDeepSeekGenerationAttempt({
        model,
        stage: "deepseek_structured_text",
        attemptIndex: attempt,
        success: true,
        usageContext: params.usageContext,
        usageMetadata,
        metadata: {
          maxOutputTokens,
          promptCacheHitTokens: response.usage?.prompt_cache_hit_tokens,
          promptCacheMissTokens: response.usage?.prompt_cache_miss_tokens,
          responseFormat: "json_object",
          thinking: "disabled",
        },
      });

      return parsed;
    } catch (error) {
      controller.abort();

      await logDeepSeekGenerationAttempt({
        model,
        stage: "deepseek_structured_text",
        attemptIndex: attempt,
        success: false,
        usageContext: params.usageContext,
        usageMetadata,
        metadata: {
          maxOutputTokens,
          promptCacheHitTokens: response?.usage?.prompt_cache_hit_tokens,
          promptCacheMissTokens: response?.usage?.prompt_cache_miss_tokens,
          responseFormat: "json_object",
          thinking: "disabled",
        },
        error,
      });

      lastError = error;

      if (attempt < maxAttempts - 1 && isRetryableAiError(error)) {
        await sleep(DEEPSEEK_RETRY_BASE_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw new Error(toErrorMessage(lastError));
}
