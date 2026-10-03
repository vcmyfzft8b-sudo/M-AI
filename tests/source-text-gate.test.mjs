import assert from "node:assert/strict";
import test from "node:test";

import { hasEnoughSourceTextToTeach } from "../src/lib/source-text-gate.ts";

test("a word is enough to teach from", () => {
  assert.equal(hasEnoughSourceTextToTeach("Fotosinteza"), true);
  assert.equal(hasEnoughSourceTextToTeach("What is a derivative?"), true);
});

// Note triage, lecture 3e3d20af: a photographed maths exercise read as formulas only, with no two
// letters in a row, and failed as source_too_short before the topic-note step could teach it.
test("a formula with no word in it is enough to teach from", () => {
  assert.equal(hasEnoughSourceTextToTeach("a) (2a+5b)^3 · (4b-1a)^2 ="), true);
  assert.equal(hasEnoughSourceTextToTeach("= (1+2+3) x^4 y^2 = 6x^4y^2"), true);
  assert.equal(hasEnoughSourceTextToTeach("3x + 4 = 19"), true);
  assert.equal(hasEnoughSourceTextToTeach("√16 · 2²"), true);
});

test("text with nothing in it still stops", () => {
  assert.equal(hasEnoughSourceTextToTeach(""), false);
  assert.equal(hasEnoughSourceTextToTeach("..."), false);
  assert.equal(hasEnoughSourceTextToTeach("12"), false);
  assert.equal(hasEnoughSourceTextToTeach("- -"), false);
  assert.equal(hasEnoughSourceTextToTeach("1 2 3 4"), false);
  assert.equal(hasEnoughSourceTextToTeach("= ="), false);
});
