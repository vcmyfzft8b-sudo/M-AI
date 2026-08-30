import assert from "node:assert/strict";
import test from "node:test";

import { detectSourceLanguage } from "../src/lib/languages.ts";
import { getStructuredPlusLabels } from "../src/lib/notes/note-prompts.ts";

/*
 * A note's headings and callout labels are literal strings handed to the model,
 * so they cannot follow the source the way the body does. They used to follow a
 * language the learner picked; nobody picks one any more, and `language_hint`
 * is null on every note created since — which resolves to English.
 *
 * This is the rule that stops a Slovenian lecture coming back under "Quick
 * Overview". `note-generation.ts` is server-only, so the resolution it performs
 * is restated here against the same two functions it composes.
 */
function resolveNoteLabelLanguage(sourceText, outputLanguage) {
  return detectSourceLanguage(sourceText) ?? outputLanguage ?? "sl";
}

const SLOVENIAN_SOURCE = `
Predavanje govori o entropiji, ki je mera nereda v sistemu. Drugi zakon
termodinamike pravi, da entropija izoliranega sistema nikoli ne pada, zato se
led v kozarcu vode stali sam od sebe, nazaj pa ne zmrzne.
`;

const ENGLISH_SOURCE = `
This lecture covers entropy, which is the measure of disorder in a system. The
second law of thermodynamics states that the entropy of an isolated system never
decreases, and that is why the ice in a glass of water melts on its own.
`;

test("a Slovenian source gets Slovenian headings", () => {
  const language = resolveNoteLabelLanguage(SLOVENIAN_SOURCE, null);

  assert.equal(language, "sl");
  assert.equal(getStructuredPlusLabels(language).overview, "## Hiter pregled");
});

test("an English source gets English headings", () => {
  const language = resolveNoteLabelLanguage(ENGLISH_SOURCE, null);

  assert.equal(language, "en");
  assert.equal(getStructuredPlusLabels(language).overview, "## Quick Overview");
});

test("an undetectable source falls back to the app's language, not English", () => {
  // Too short to count, which is exactly when the old default mattered.
  const language = resolveNoteLabelLanguage("Ok.", null);

  assert.equal(language, "sl");
  assert.equal(getStructuredPlusLabels(language).overview, "## Hiter pregled");
});

test("a stored hint is still honoured when detection cannot decide", () => {
  assert.equal(resolveNoteLabelLanguage("Ok.", "de"), "de");
});

test("the source outranks a stale stored hint", () => {
  // A lecture created back when everything defaulted to "sl", whose material is
  // in fact English: the note should not be given Slovenian furniture.
  assert.equal(resolveNoteLabelLanguage(ENGLISH_SOURCE, "sl"), "en");
});
