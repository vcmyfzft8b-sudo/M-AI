import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFormulaSyntax } from "../src/lib/math-markdown.ts";

test("prose inside \\text{} is never rewritten as maths", () => {
  // Measured on a production accounting note: "\text{Začetno stanje}" came back as
  // "\text{Z_{a}četno stanje}" and KaTeX printed the whole formula in red to the learner.
  // JavaScript's \b is ASCII-only, so it saw a word boundary between the a and the č.
  const formula =
    "\\text{Končno stanje} = \\text{Začetno stanje (1. 1.)} + \\text{Prenosi iz OS/NN}";

  assert.equal(normalizeFormulaSyntax(formula), formula);
});

test("accented words keep their letters", () => {
  for (const word of ["Šola", "Čas", "Že", "Država", "Računovodstvo"]) {
    const formula = `\\text{${word}}`;

    assert.equal(normalizeFormulaSyntax(formula), formula);
    assert.doesNotMatch(normalizeFormulaSyntax(formula), /_\{/);
  }
});

test("real subscripts are still repaired", () => {
  assert.equal(normalizeFormulaSyntax("V1 = V2"), "V_{1} = V_{2}");
  assert.equal(normalizeFormulaSyntax("C{out} = 30"), "C_{out} = 30");
});

test("symbols outside \\text{} are still converted", () => {
  assert.match(normalizeFormulaSyntax("a ≤ b"), /\\le/);
  assert.match(normalizeFormulaSyntax("x → y"), /\\to/);
  // ...and the same symbol inside prose is left alone.
  assert.equal(normalizeFormulaSyntax("\\text{do 5 ≤ 10}"), "\\text{do 5 ≤ 10}");
});

test("a fraction never splices into a \\text span", async () => {
  // The production accounting note rendered "780\tex\frac{t{ EUR}}{\text{enoto}}" in red: the
  // slash-to-\frac rewriter walked its operand boundary into the middle of \text{ EUR}.
  const formula = "780\\text{ EUR}/\\text{enoto}";
  const out = normalizeFormulaSyntax(formula);

  assert.ok(!out.includes("\\tex\\frac"), out);
  assert.ok(out.includes("\\text{ EUR}"), out);
  assert.ok(out.includes("\\text{enoto}"), out);
});

test("stray \\text in prose is unwrapped at write time, math spans untouched", async () => {
  const { stripBareTextMacrosFromProse } = await import("../src/lib/math-markdown.ts");
  const note = [
    "- Začetna zaloga: 50\\text{ enot} z vrednostjo 39.000\\text{ EUR}",
    "| cena | 780\\text{ EUR} |",
    "$$\\text{Povprečna cena} = 750$$",
  ].join("\n");
  const out = stripBareTextMacrosFromProse(note);

  assert.ok(out.includes("50 enot z vrednostjo 39.000 EUR"), out);
  // Table rows and math spans keep their bytes.
  assert.ok(out.includes("| cena | 780\\text{ EUR} |"), out);
  assert.ok(out.includes("$$\\text{Povprečna cena} = 750$$"), out);
});
