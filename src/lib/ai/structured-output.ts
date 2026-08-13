import { z } from "zod";

import type { FinishReason } from "@google/genai";

// Kept free of "server-only" so the structured-output contract stays unit-testable
// (tests/gemini-structured-output.test.mjs) outside the Next.js runtime.

const STRUCTURED_RETRY_TOKEN_GROWTH = 0.4;
const TRUNCATED_RETRY_TOKEN_GROWTH = 0.8;

export class GeminiTruncatedOutputError extends Error {
  constructor(maxOutputTokens: number | undefined) {
    super(
      maxOutputTokens
        ? `Model output was truncated: generation hit the ${maxOutputTokens}-token output limit before the JSON object was complete.`
        : "Model output was truncated: generation hit the output token limit before the JSON object was complete.",
    );
    this.name = "GeminiTruncatedOutputError";
  }
}

export function isTruncatedFinishReason(finishReason: FinishReason | string | undefined) {
  return finishReason === "MAX_TOKENS";
}

export function stripCodeFences(value: string) {
  return value.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

export function extractJsonPayload(value: string) {
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

export function parseStructuredText<TSchema extends z.ZodTypeAny>(schema: TSchema, text: string) {
  return schema.parse(JSON.parse(extractJsonPayload(text)));
}

export function toErrorMessage(error: unknown) {
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

// A truncated attempt failed because the requested content did not fit, so the retry has to
// both raise the budget faster than the generic invalid-JSON path and tell the model to
// compress — repeating the same content into a slightly larger window converges too slowly.
export function resolveStructuredMaxOutputTokens(
  baseMaxOutputTokens: number | undefined,
  attempt: number,
  lastError: unknown,
) {
  if (!baseMaxOutputTokens) {
    return undefined;
  }

  if (attempt === 0) {
    return Math.round(baseMaxOutputTokens);
  }

  const growthPerAttempt =
    lastError instanceof GeminiTruncatedOutputError
      ? TRUNCATED_RETRY_TOKEN_GROWTH
      : STRUCTURED_RETRY_TOKEN_GROWTH;

  return Math.round(baseMaxOutputTokens * (1 + attempt * growthPerAttempt));
}

export function buildStructuredRetryInstruction(lastError: unknown) {
  if (!lastError) {
    return "";
  }

  if (lastError instanceof GeminiTruncatedOutputError) {
    return "\n\nYour previous response was cut off because it exceeded the output token limit. Rewrite the response so the complete JSON object fits within the limit: keep the same coverage of the source material but be significantly more concise — shorter paragraphs, tighter bullet points, no repeated ideas. The JSON object must end with its closing brace.";
  }

  return `\n\nPrevious attempt failed because the JSON was invalid: ${toErrorMessage(
    lastError,
  )}. Return exactly one valid JSON object matching the schema.`;
}
