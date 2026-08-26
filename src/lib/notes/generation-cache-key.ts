// Kept free of "server-only" so the key contract stays unit-testable
// (tests/generation-cache-key.test.mjs) outside the Next.js runtime.

import { createHash } from "node:crypto";

/**
 * Content hash for one checkpointed generation call. The parts are the call's exact model input
 * (instructions, source window, output budget), so any change to prompts or content produces a
 * different key and stale checkpoints simply stop matching instead of needing invalidation.
 */
export function generationCacheKey(parts: ReadonlyArray<string | number | null | undefined>) {
  const hash = createHash("sha256");

  for (const part of parts) {
    // Length-prefixed so ["ab","c"] and ["a","bc"] cannot collide.
    const text = part == null ? " " : String(part);
    hash.update(`${text.length}:`);
    hash.update(text);
  }

  return hash.digest("hex");
}
