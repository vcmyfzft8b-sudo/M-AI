import type { PartMediaResolutionLevel, ThinkingConfig } from "@google/genai";

// Kept free of "server-only" so the model-capability gate stays unit-testable
// (tests/gemini-media-resolution.test.mjs) outside the Next.js runtime.

// Per-part media resolution arrived with Gemini 3. Sending the field to a 2.5 model does not
// degrade gracefully — the API rejects the whole request with a bare
// 400 "Request contains an invalid argument." that names no field, so the call never happens.
const MIN_PART_MEDIA_RESOLUTION_MAJOR_VERSION = 3;

function getGeminiMajorVersion(model: string) {
  const majorVersion = Number.parseInt(model.match(/gemini-(\d+)/i)?.[1] ?? "", 10);

  return Number.isNaN(majorVersion) ? null : majorVersion;
}

/**
 * Returns the media resolution to send with an uploaded file part, or undefined when the model
 * cannot accept one. Unrecognised model names drop the field: falling back to the model's default
 * resolution costs some detail, while sending an unsupported field costs the entire generation.
 */
export function resolvePartMediaResolution(
  model: string,
  mediaResolution: PartMediaResolutionLevel | undefined,
) {
  if (!mediaResolution) {
    return undefined;
  }

  const majorVersion = getGeminiMajorVersion(model);

  return majorVersion != null && majorVersion >= MIN_PART_MEDIA_RESOLUTION_MAJOR_VERSION
    ? mediaResolution
    : undefined;
}

/**
 * Thinking-suppression is version-specific, and both wrong choices fail with a bare
 * 400 "Request contains an invalid argument" that names no field:
 * - 2.5 models do not think and reject thinking fields; send nothing.
 * - 3.0/3.1 models accept `thinkingBudget: 0` (what OCR has always sent).
 * - 3.5+ models reject `thinkingBudget` outright and take `thinkingLevel` instead, where
 *   MINIMAL is the measured no-thinking setting (0 thought tokens on the OCR benchmark).
 * Verified against the live API on 2026-08-22 (scripts/ocr-eval.mjs and a direct probe).
 */
export function resolveMinimalThinkingConfig(model: string): ThinkingConfig | undefined {
  const versionMatch = model.match(/gemini-(\d+)(?:\.(\d+))?/i);
  const major = Number.parseInt(versionMatch?.[1] ?? "", 10);
  const minor = Number.parseInt(versionMatch?.[2] ?? "0", 10);

  if (Number.isNaN(major) || major < 3) {
    return undefined;
  }

  if (major === 3 && minor < 5) {
    return { thinkingBudget: 0, includeThoughts: false };
  }

  return { thinkingLevel: "MINIMAL" as ThinkingConfig["thinkingLevel"] };
}
