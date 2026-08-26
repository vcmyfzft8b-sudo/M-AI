import assert from "node:assert/strict";
import test from "node:test";

import { generationCacheKey } from "../src/lib/notes/generation-cache-key.ts";

test("the same call input always produces the same key", () => {
  const key = generationCacheKey(["instructions", "Chunk 1 of 3", "window text", 2400]);

  assert.equal(key, generationCacheKey(["instructions", "Chunk 1 of 3", "window text", 2400]));
  assert.match(key, /^[0-9a-f]{64}$/);
});

test("any changed part changes the key, so stale checkpoints stop matching by themselves", () => {
  const base = generationCacheKey(["instructions", "Chunk 1 of 3", "window text", 2400]);

  assert.notEqual(base, generationCacheKey(["instructions v2", "Chunk 1 of 3", "window text", 2400]));
  assert.notEqual(base, generationCacheKey(["instructions", "Chunk 2 of 3", "window text", 2400]));
  assert.notEqual(base, generationCacheKey(["instructions", "Chunk 1 of 3", "edited text", 2400]));
  assert.notEqual(base, generationCacheKey(["instructions", "Chunk 1 of 3", "window text", 3600]));
});

test("part boundaries are unambiguous", () => {
  // Without length prefixing these two would hash the same bytes and alias each other's results.
  assert.notEqual(generationCacheKey(["ab", "c"]), generationCacheKey(["a", "bc"]));
});
