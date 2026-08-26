import "server-only";

import {
  GoogleGenAI,
  PartMediaResolutionLevel,
  createPartFromUri,
  type GenerateContentResponseUsageMetadata,
  type ThinkingConfig,
} from "@google/genai";
import { z } from "zod";

import { WorkAbortedError, getCurrentAbortSignal, isWorkAbortedError } from "@/lib/abort-context";
import { isRetryableAiError } from "@/lib/ai/errors";
import { resolvePartMediaResolution } from "@/lib/ai/gemini-models";
import {
  GeminiTruncatedOutputError,
  buildStructuredRetryInstruction,
  isTruncatedFinishReason,
  parseStructuredText,
  resolveStructuredMaxOutputTokens,
  stripCodeFences,
  toErrorMessage,
} from "@/lib/ai/structured-output";
import { logGeminiUsageEvent, type GeminiUsageContext } from "@/lib/ai/usage-logging";
import { requireGeminiEnv } from "@/lib/server-env";

const GEMINI_GENERATION_MAX_ATTEMPTS = 4;
const GEMINI_EMBEDDING_DIMENSION = 1536;
const GEMINI_EMBEDDING_MAX_BATCH_SIZE = 100;
const GEMINI_EMBEDDING_BATCH_DELAY_MS = 250;
const GEMINI_GENERATION_TIMEOUT_MS = 90_000;
const GEMINI_RETRY_BASE_DELAY_MS = 1_500;
const GEMINI_RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

let geminiClient: GoogleGenAI | undefined;

export class GeminiEmptyTextOutputError extends Error {
  constructor() {
    super("Model returned empty text output.");
    this.name = "GeminiEmptyTextOutputError";
  }
}

function isGeminiSchemaTooComplexError(error: unknown) {
  const message = toErrorMessage(error).toLowerCase();

  return (
    message.includes("too many states for serving") ||
    (message.includes("invalid_argument") && message.includes("specified schema"))
  );
}

function isStructuredOutputError(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return true;
  }

  const message = toErrorMessage(error).toLowerCase();

  return (
    message.includes("json") ||
    message.includes("invalid structured output") ||
    message.includes("expected") ||
    message.includes("too small")
  );
}

function getStructuredGenerationRetryDelayMs(error: unknown, attempt: number) {
  if (isRetryableAiError(error)) {
    return getRetryableAiDelayMs(attempt);
  }

  if (error instanceof GeminiTruncatedOutputError || isStructuredOutputError(error)) {
    return Math.round((GEMINI_RETRY_BASE_DELAY_MS / 3) * (attempt + 1));
  }

  return null;
}

function getRetryableAiDelayMs(attempt: number) {
  return GEMINI_RETRY_DELAYS_MS[attempt] ?? GEMINI_RETRY_DELAYS_MS.at(-1) ?? GEMINI_RETRY_BASE_DELAY_MS;
}

function sanitizeGeminiUploadFileName(fileName: string | undefined, fallback: string) {
  const rawName = fileName?.trim() || fallback;
  const extensionMatch = rawName.match(/\.([A-Za-z0-9]{1,12})$/);
  const extension = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : "";
  const baseName = rawName
    .replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 72);
  const safeBaseName = baseName || fallback.replace(/\.[^.]*$/, "") || "document";

  return `${safeBaseName}${extension || ".bin"}`;
}

function createGeminiTempFilePath(file: File, fallback: string) {
  return `/tmp/${crypto.randomUUID()}-${sanitizeGeminiUploadFileName(file.name, fallback)}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  // A request that loses the race can still reject later (e.g. when the budget abort lands);
  // without a handler that late rejection would surface as an unhandled one.
  promise.catch(() => undefined);

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
    return GEMINI_GENERATION_MAX_ATTEMPTS;
  }

  return Math.max(1, Math.min(GEMINI_GENERATION_MAX_ATTEMPTS, Math.floor(maxAttempts)));
}

async function logGenerationAttempt(params: {
  model: string;
  stage: string;
  attemptIndex: number;
  success: boolean;
  usageContext?: GeminiUsageContext;
  usageMetadata?: GenerateContentResponseUsageMetadata | null;
  metadata?: Record<string, unknown>;
  error?: unknown;
}) {
  await logGeminiUsageEvent({
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

export function getGeminiClient() {
  if (!geminiClient) {
    const env = requireGeminiEnv();
    geminiClient = new GoogleGenAI({
      apiKey: env.GEMINI_API_KEY,
    });
  }

  return geminiClient;
}

export async function generateStructuredObjectWithGemini<TSchema extends z.ZodTypeAny>(params: {
  schema: TSchema;
  instructions: string;
  input: string;
  model: string;
  maxOutputTokens?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  thinkingConfig?: ThinkingConfig;
  usageContext?: GeminiUsageContext;
}) {
  const ai = getGeminiClient();
  let lastError: unknown = null;
  let useResponseSchema = true;
  const responseSchema = z.toJSONSchema(params.schema);
  const maxAttempts = resolveMaxAttempts(params.maxAttempts);
  const timeoutMs = params.timeoutMs ?? GEMINI_GENERATION_TIMEOUT_MS;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // The surrounding invocation budget aborts this signal when it runs out. Checking before the
    // attempt — and handing the signal to the SDK so the in-flight request dies too — is what
    // keeps a budget-killed pipeline from continuing to buy tokens as a zombie.
    const abortSignal = getCurrentAbortSignal();

    if (abortSignal?.aborted) {
      throw new WorkAbortedError();
    }

    const retryInstruction = buildStructuredRetryInstruction(lastError);

    try {
      const maxOutputTokens = resolveStructuredMaxOutputTokens(
        params.maxOutputTokens,
        attempt,
        lastError,
      );
      let response:
        | Awaited<ReturnType<typeof ai.models.generateContent>>
        | undefined;

      try {
        response = await withTimeout(
          ai.models.generateContent({
            model: params.model,
            contents: `${params.instructions}${retryInstruction}

Return exactly one JSON object that matches this JSON schema:
${JSON.stringify(responseSchema)}

Source input:
${params.input}`,
            config: {
              responseMimeType: "application/json",
              ...(useResponseSchema ? { responseSchema } : {}),
              maxOutputTokens,
              ...(params.thinkingConfig ? { thinkingConfig: params.thinkingConfig } : {}),
              ...(abortSignal ? { abortSignal } : {}),
            },
          }),
          timeoutMs,
          "Gemini structured generation",
        );

        const outputText = stripCodeFences(response.text ?? "");
        const truncated = isTruncatedFinishReason(response.candidates?.[0]?.finishReason);

        if (!outputText) {
          if (truncated) {
            throw new GeminiTruncatedOutputError(maxOutputTokens);
          }

          throw new Error("Model returned empty structured output.");
        }

        let parsed: z.infer<TSchema>;

        try {
          parsed = parseStructuredText(params.schema, outputText);
        } catch (parseError) {
          if (truncated) {
            throw new GeminiTruncatedOutputError(maxOutputTokens);
          }

          throw parseError;
        }
        await logGenerationAttempt({
          model: params.model,
          stage: "gemini_structured_text",
          attemptIndex: attempt,
          success: true,
          usageContext: params.usageContext,
          usageMetadata: response.usageMetadata,
          metadata: {
            maxOutputTokens,
            responseMimeType: "application/json",
            responseSchema: useResponseSchema,
          },
        });

        return parsed;
      } catch (error) {
        await logGenerationAttempt({
          model: params.model,
          stage: "gemini_structured_text",
          attemptIndex: attempt,
          success: false,
          usageContext: params.usageContext,
          usageMetadata: response?.usageMetadata,
          metadata: {
            maxOutputTokens,
            responseMimeType: "application/json",
            responseSchema: useResponseSchema,
          },
          error,
        });

        throw error;
      }
    } catch (error) {
      // An abort is the budget ending, not the model failing — retrying would be the exact
      // zombie-run behaviour the signal exists to stop.
      if (isWorkAbortedError(error) || getCurrentAbortSignal()?.aborted) {
        throw error;
      }

      if (useResponseSchema && isGeminiSchemaTooComplexError(error)) {
        useResponseSchema = false;
      }

      lastError = error;

      const retryDelayMs = getStructuredGenerationRetryDelayMs(error, attempt);

      if (attempt < maxAttempts - 1 && retryDelayMs != null) {
        await sleep(retryDelayMs);
      }
    }
  }

  throw new Error(toErrorMessage(lastError));
}

export async function generateStructuredObjectWithGeminiFile<TSchema extends z.ZodTypeAny>(params: {
  schema: TSchema;
  instructions: string;
  file: File;
  model: string;
  maxOutputTokens?: number;
  maxAttempts?: number;
  thinkingConfig?: ThinkingConfig;
  mediaResolution?: PartMediaResolutionLevel;
  usageContext?: GeminiUsageContext;
}) {
  const ai = getGeminiClient();
  const tempPath = createGeminiTempFilePath(params.file, "document.bin");
  const bytes = Buffer.from(await params.file.arrayBuffer());
  const fs = await import("node:fs/promises");
  let uploadedFileName: string | null = null;
  let lastError: unknown = null;
  let useResponseSchema = true;
  const responseSchema = z.toJSONSchema(params.schema);
  const maxAttempts = resolveMaxAttempts(params.maxAttempts);
  const mediaResolution = resolvePartMediaResolution(params.model, params.mediaResolution);

  await fs.writeFile(tempPath, bytes);

  try {
    const uploaded = await ai.files.upload({
      file: tempPath,
      config: {
        mimeType: params.file.type || "application/octet-stream",
      },
    });

    uploadedFileName = uploaded.name ?? null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const abortSignal = getCurrentAbortSignal();

      if (abortSignal?.aborted) {
        throw new WorkAbortedError();
      }

      const retryInstruction = buildStructuredRetryInstruction(lastError);

      try {
        const maxOutputTokens = resolveStructuredMaxOutputTokens(
          params.maxOutputTokens,
          attempt,
          lastError,
        );
        let response:
          | Awaited<ReturnType<typeof ai.models.generateContent>>
          | undefined;

        try {
          response = await withTimeout(
            ai.models.generateContent({
              model: params.model,
              contents: [
                `${params.instructions}${retryInstruction}

Return exactly one JSON object that matches this JSON schema:
${JSON.stringify(responseSchema)}`,
                createPartFromUri(
                  uploaded.uri ?? "",
                  uploaded.mimeType ?? params.file.type ?? "application/octet-stream",
                  mediaResolution,
                ),
              ],
              config: {
                responseMimeType: "application/json",
                ...(useResponseSchema ? { responseSchema } : {}),
                maxOutputTokens,
                ...(params.thinkingConfig ? { thinkingConfig: params.thinkingConfig } : {}),
                ...(abortSignal ? { abortSignal } : {}),
              },
            }),
            GEMINI_GENERATION_TIMEOUT_MS,
            "Gemini document extraction",
          );

          const outputText = stripCodeFences(response.text ?? "");
          const truncated = isTruncatedFinishReason(response.candidates?.[0]?.finishReason);

          if (!outputText) {
            if (truncated) {
              throw new GeminiTruncatedOutputError(maxOutputTokens);
            }

            throw new Error("Model returned empty structured output.");
          }

          let parsed: z.infer<TSchema>;

          try {
            parsed = parseStructuredText(params.schema, outputText);
          } catch (parseError) {
            if (truncated) {
              throw new GeminiTruncatedOutputError(maxOutputTokens);
            }

            throw parseError;
          }
          await logGenerationAttempt({
            model: params.model,
            stage: "gemini_structured_file",
            attemptIndex: attempt,
            success: true,
            usageContext: params.usageContext,
            usageMetadata: response.usageMetadata,
            metadata: {
              fileMimeType: uploaded.mimeType ?? params.file.type ?? "application/octet-stream",
              maxOutputTokens,
              mediaResolution,
              responseMimeType: "application/json",
              responseSchema: useResponseSchema,
            },
          });

          return parsed;
        } catch (error) {
          await logGenerationAttempt({
            model: params.model,
            stage: "gemini_structured_file",
            attemptIndex: attempt,
            success: false,
            usageContext: params.usageContext,
            usageMetadata: response?.usageMetadata,
            metadata: {
              fileMimeType: uploaded.mimeType ?? params.file.type ?? "application/octet-stream",
              maxOutputTokens,
              mediaResolution,
              responseMimeType: "application/json",
              responseSchema: useResponseSchema,
            },
            error,
          });

          throw error;
        }
      } catch (error) {
        if (isWorkAbortedError(error) || getCurrentAbortSignal()?.aborted) {
          throw error;
        }

        if (useResponseSchema && isGeminiSchemaTooComplexError(error)) {
          useResponseSchema = false;
        }

        lastError = error;

        const retryDelayMs = getStructuredGenerationRetryDelayMs(error, attempt);

        if (attempt < maxAttempts - 1 && retryDelayMs != null) {
          await sleep(retryDelayMs);
        }
      }
    }

    throw new Error(toErrorMessage(lastError));
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => null);

    if (uploadedFileName) {
      await ai.files.delete({ name: uploadedFileName }).catch(() => null);
    }
  }
}

export async function generateTextWithGeminiFile(params: {
  instructions: string;
  file: File;
  model: string;
  maxOutputTokens?: number;
  maxAttempts?: number;
  thinkingConfig?: ThinkingConfig;
  mediaResolution?: PartMediaResolutionLevel;
  usageContext?: GeminiUsageContext;
}) {
  const ai = getGeminiClient();
  const tempPath = createGeminiTempFilePath(params.file, "document.bin");
  const bytes = Buffer.from(await params.file.arrayBuffer());
  const fs = await import("node:fs/promises");
  let uploadedFileName: string | null = null;
  let lastError: unknown = null;
  const maxAttempts = resolveMaxAttempts(params.maxAttempts);
  const mediaResolution = resolvePartMediaResolution(params.model, params.mediaResolution);

  await fs.writeFile(tempPath, bytes);

  try {
    const uploaded = await ai.files.upload({
      file: tempPath,
      config: {
        mimeType: params.file.type || "application/octet-stream",
      },
    });

    uploadedFileName = uploaded.name ?? null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const abortSignal = getCurrentAbortSignal();

      if (abortSignal?.aborted) {
        throw new WorkAbortedError();
      }

      const retryInstruction =
        attempt === 0 || !lastError
          ? ""
          : `\n\nPrevious attempt failed: ${toErrorMessage(
              lastError,
            )}. Return plain text only, no JSON, no markdown fences.`;

      try {
        const maxOutputTokens = params.maxOutputTokens
          ? Math.round(params.maxOutputTokens * (attempt === 0 ? 1 : 1 + attempt * 0.4))
          : undefined;
        let response:
          | Awaited<ReturnType<typeof ai.models.generateContent>>
          | undefined;

        try {
          response = await withTimeout(
            ai.models.generateContent({
              model: params.model,
              contents: [
                `${params.instructions}${retryInstruction}`,
                createPartFromUri(
                  uploaded.uri ?? "",
                  uploaded.mimeType ?? params.file.type ?? "application/octet-stream",
                  mediaResolution,
                ),
              ],
              config: {
                responseMimeType: "text/plain",
                maxOutputTokens,
                ...(params.thinkingConfig ? { thinkingConfig: params.thinkingConfig } : {}),
                ...(abortSignal ? { abortSignal } : {}),
              },
            }),
            GEMINI_GENERATION_TIMEOUT_MS,
            "Gemini text extraction",
          );

          const outputText = stripCodeFences(response.text ?? "");

          if (!outputText) {
            throw new GeminiEmptyTextOutputError();
          }

          await logGenerationAttempt({
            model: params.model,
            stage: "gemini_text_file",
            attemptIndex: attempt,
            success: true,
            usageContext: params.usageContext,
            usageMetadata: response.usageMetadata,
            metadata: {
              fileMimeType: uploaded.mimeType ?? params.file.type ?? "application/octet-stream",
              maxOutputTokens,
              mediaResolution,
              responseMimeType: "text/plain",
            },
          });

          return outputText;
        } catch (error) {
          await logGenerationAttempt({
            model: params.model,
            stage: "gemini_text_file",
            attemptIndex: attempt,
            success: false,
            usageContext: params.usageContext,
            usageMetadata: response?.usageMetadata,
            metadata: {
              fileMimeType: uploaded.mimeType ?? params.file.type ?? "application/octet-stream",
              maxOutputTokens,
              mediaResolution,
              responseMimeType: "text/plain",
            },
            error,
          });

          throw error;
        }
      } catch (error) {
        if (isWorkAbortedError(error) || getCurrentAbortSignal()?.aborted) {
          throw error;
        }

        lastError = error;

        if (attempt < maxAttempts - 1 && isRetryableAiError(error)) {
          await sleep(getRetryableAiDelayMs(attempt));
        }
      }
    }

    if (lastError instanceof GeminiEmptyTextOutputError) {
      throw lastError;
    }

    throw new Error(toErrorMessage(lastError));
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => null);

    if (uploadedFileName) {
      await ai.files.delete({ name: uploadedFileName }).catch(() => null);
    }
  }
}

export async function createGeminiEmbeddings(texts: string[]) {
  if (texts.length === 0) {
    return [];
  }

  const ai = getGeminiClient();
  const env = requireGeminiEnv();
  const embeddings: number[][] = [];

  for (let start = 0; start < texts.length; start += GEMINI_EMBEDDING_MAX_BATCH_SIZE) {
    const batch = texts.slice(start, start + GEMINI_EMBEDDING_MAX_BATCH_SIZE);
    let batchEmbeddings: number[][] | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < GEMINI_GENERATION_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await ai.models.embedContent({
          model: env.GEMINI_EMBEDDING_MODEL,
          contents: batch,
          config: {
            outputDimensionality: GEMINI_EMBEDDING_DIMENSION,
          },
        });

        batchEmbeddings = (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
        break;
      } catch (error) {
        lastError = error;

        if (attempt < GEMINI_GENERATION_MAX_ATTEMPTS - 1 && isRetryableAiError(error)) {
          await sleep(getRetryableAiDelayMs(attempt));
          continue;
        }

        throw error;
      }
    }

    if (!batchEmbeddings) {
      throw new Error(toErrorMessage(lastError));
    }

    embeddings.push(...batchEmbeddings);

    if (start + GEMINI_EMBEDDING_MAX_BATCH_SIZE < texts.length) {
      await sleep(GEMINI_EMBEDDING_BATCH_DELAY_MS);
    }
  }

  return embeddings;
}
