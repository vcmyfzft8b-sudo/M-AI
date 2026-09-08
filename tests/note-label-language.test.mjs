import assert from "node:assert/strict";
import test from "node:test";

import { resolveMaterialLanguage } from "../src/lib/languages.ts";
import {
  buildLegacyStructuredPlusInstructions,
  buildSourceNoteInstructions,
  getStructuredPlusLabels,
} from "../src/lib/notes/note-prompts.ts";

// Exercise the shared source resolver, not a local copy of the old Slovenian default.
const resolveNoteLabelLanguage = resolveMaterialLanguage;

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

test("an undetectable source never invents Slovenian", () => {
  // Too short to count, which is exactly when the old default mattered.
  const language = resolveNoteLabelLanguage("Ok.", null);

  assert.equal(language, "en");
  assert.equal(getStructuredPlusLabels(language).overview, "## Quick Overview");
});

test("a stored hint is still honoured when detection cannot decide", () => {
  assert.equal(resolveNoteLabelLanguage("Ok.", "de"), "de");
});

test("the source outranks a stale stored hint", () => {
  // A lecture created back when everything defaulted to "sl", whose material is
  // in fact English: the note should not be given Slovenian furniture.
  assert.equal(resolveNoteLabelLanguage(ENGLISH_SOURCE, "sl"), "en");
});

/*
 * ...and the same rule where it actually lands: the composed prompt.
 *
 * The two note paths carry different furniture. The live content-driven path
 * lets the model write its own section headings and only fixes the callout
 * labels — which `note-tts-text.ts` then matches to colour the boxes, and which
 * a reader sees in bold inside their own sentences. The legacy path fixes the
 * headings too. Both are literal strings, and both would have been English.
 */
test("the live path's callout labels follow the source", () => {
  const slovenian = buildSourceNoteInstructions({
    outputLanguage: resolveNoteLabelLanguage(SLOVENIAN_SOURCE, null),
  });

  assert.match(slovenian, /\*\*Definicija:\*\*/);
  assert.match(slovenian, /\*\*Pogosta napaka:\*\*/);
  assert.match(slovenian, /\*\*Ključno:\*\*/);
  assert.doesNotMatch(slovenian, /\*\*Key takeaway:\*\*/);

  const english = buildSourceNoteInstructions({
    outputLanguage: resolveNoteLabelLanguage(ENGLISH_SOURCE, null),
  });

  assert.match(english, /\*\*Key takeaway:\*\*/);
  assert.doesNotMatch(english, /\*\*Ključno:\*\*/);
});

test("the legacy path's headings follow the source", () => {
  const legacy = buildLegacyStructuredPlusInstructions({
    outputLanguage: resolveNoteLabelLanguage(SLOVENIAN_SOURCE, null),
    recommendedTopicCount: 8,
  });

  assert.match(legacy, /Hiter pregled/);
  assert.doesNotMatch(legacy, /Quick Overview/);
});
