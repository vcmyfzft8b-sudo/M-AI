import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMathDelimiters } from "../src/lib/markdown-math-delimiters.ts";

test("inline paren math becomes inline double-dollar math", () => {
  assert.equal(
    normalizeMathDelimiters("Tudi \\(Y_t\\) je spremenljivka."),
    "Tudi $$Y_t$$ je spremenljivka.",
  );
});

test("currency amounts and code fences pass through untouched", () => {
  const table = "| Soul | $30 |\n| Terra | \\$12--\\$15 |";
  assert.equal(normalizeMathDelimiters(table), table);

  const fenced = "```\n\\(not math, code\\)\n```";
  assert.equal(normalizeMathDelimiters(fenced), fenced);
});
