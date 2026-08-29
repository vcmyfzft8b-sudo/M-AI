import { z } from "zod";

import type { FinishReason } from "@google/genai";

import { sanitizeJsonForDatabase } from "../database-text.ts";

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
  // Sanitized before validation, so the schema judges the value that will actually be used.
  // Model output can carry U+0000 and lone surrogates — GLM produced a lone surrogate in a
  // flashcard on its first day (2026-08-28), and one such character fails the entire Supabase
  // insert with "invalid input syntax for type json" (see database-text.ts). Neither character
  // can mean anything: a lone surrogate cannot even be UTF-8 encoded to send anywhere.
  return schema.parse(sanitizeJsonForDatabase(JSON.parse(extractJsonPayload(text))));
}

/**
 * How a failed gateway call should be handled, from the shape of its error:
 *
 * - "truncated": the model ran past its token budget — stochastic, retryable on the same model
 *   with a grown budget (fails fast, so a retry fits the invocation).
 * - "timeout": the call burned its whole leash. A same-model retry cannot fit the invocation;
 *   go straight to the fallback tier.
 * - "other": 5xx, refused schema, bad host — fail fast, retry or fall back freely.
 */
export function classifyGatewayFailure(error: unknown): "truncated" | "timeout" | "other" {
  if (error instanceof GeminiTruncatedOutputError) {
    return "truncated";
  }

  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "timeout";
  }

  return "other";
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
