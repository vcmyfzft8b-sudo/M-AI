import type { PartMediaResolutionLevel } from "@google/genai";

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
