import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMarkdownMath } from "../src/lib/math-markdown.ts";

test("table rows with escaped prices are never wrapped as display math", () => {
  // Verbatim shape from a real note whose comparison table was destroyed at write time.
  const markdown = [
    "### Primerjava",
    "| Model | Cena izhoda (na 1M žetonov) | Ocena / Razred |",
    "|---|---|---|",
    "| 56 Soul | \\$30 | S/A razred |",
    "| 56 Terra | \\$12--\\$15 | C razred |",
    "| Luna | Znižano na \\$120 / ugodno | A razred |",
  ].join("\n");

  const normalized = normalizeMarkdownMath(markdown);

  assert.ok(!normalized.includes("$$"), "no table row may become display math");
  assert.ok(normalized.includes("| 56 Soul | \\$30 | S/A razred |"), "row must stay verbatim");
  assert.ok(!normalized.includes("\\frac"), "no fraction repair inside prose cells");
});

test("a genuine standalone formula line still gets promoted to display math", () => {
  const normalized = normalizeMarkdownMath("I_{t/0} = (Y_t / Y_0) * 100");

  assert.ok(normalized.includes("$$"), "real formulas keep their promotion");
});
