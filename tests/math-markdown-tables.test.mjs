import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMarkdownMath } from "../src/lib/math-markdown.ts";
import { parseNoteTtsDocument } from "../src/lib/note-tts-text.ts";

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

test("an empty leading header cell stays a cell instead of shifting the header row", () => {
  // Verbatim shape from a real production note (WEF automation table): the header's first cell
  // is deliberately empty, and dropping it rendered every header label one column to the left
  // with the last data column headerless.
  const markdown = [
    "| | zaposleni | človek + tehnologija | tehnologija |",
    "|---|---|---|---|",
    "| 2025 | 50 % | 33 % | 17 % |",
    "| 2030 | 33 % | 33 % | 33 % |",
  ].join("\n");

  const table = parseNoteTtsDocument(markdown).blocks.find((block) => block.kind === "table");

  assert.ok(table, "table parsed");
  assert.deepEqual(
    table.rows.map((row) => row.cells.length),
    [4, 4, 4],
    "every row keeps all four cells, including the empty header cell",
  );
  assert.equal(table.rows[0].cells[0].tokens.length, 0, "the empty header cell has no tokens");
  assert.equal(
    table.rows[0].cells[1].tokens.some((token) => token.text.includes("zaposleni")),
    true,
    "labels sit above their own columns again",
  );
});
