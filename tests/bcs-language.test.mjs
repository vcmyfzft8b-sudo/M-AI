import assert from "node:assert/strict";
import test from "node:test";

import { detectSourceLanguage } from "../src/lib/languages.ts";
import {
  buildSourceNoteInstructions,
  getStructuredPlusLabels,
} from "../src/lib/notes/note-prompts.ts";

// Distinguish the varieties instead of intentionally mapping Bosnian to Croatian.
const SAMPLES = {
  hr: "Tržište funkcionira kao pregovor između kupaca i prodavača, koji žele nisku cijenu, ali se cijena ustali ondje gdje se količine poklope. To je ravnoteža, jer se nakon toga mijenja samo kada se promijeni neki drugi čimbenik, prema onome što vrijedi.",
  sr: "Tržište funkcioniše kao pregovor između kupaca i prodavaca, koji žele nisku cenu, ali se cena ustali onde gde se količine poklope. To je ravnoteža, jer se posle toga menja samo kada se promeni neki drugi faktor, prema onome što važi, a primer je uvek isti.",
};

for (const [code, text] of Object.entries(SAMPLES)) {
  test(`a paragraph of ${code} notes is detected as ${code}`, () => {
    assert.equal(detectSourceLanguage(text), code);
  });
}

test("Bosnian material retains Bosnian vocabulary", () => {
  const bosnian =
    "Tržište funkcioniše kao pregovor između kupaca i prodavača, koji žele nisku cijenu, ali se cijena ustali ondje gdje se količine poklope. To je ravnoteža, jer se poslije toga mijenja samo kada se promijeni neki drugi faktor, prema onome što vrijedi.";

  assert.equal(detectSourceLanguage(bosnian), "bs");
});

test("Slovenian is not swept into the shared bucket", () => {
  const slovenian =
    "Trg deluje kot pogajanje med kupci in prodajalci, ki želijo nizko ceno, prodajalci pa visoko, cena pa se ustali tam, kjer se želena količina nakupa in prodaje ujameta. Ta točka je tržno ravnovesje, zato lahko pri vsaki spremembi nastane novo ravnovesje.";

  assert.equal(detectSourceLanguage(slovenian), "sl");
});

test("each of the four languages has its own note furniture, not English", () => {
  assert.equal(getStructuredPlusLabels("hr").overview, "## Brzi pregled");
  assert.equal(getStructuredPlusLabels("bs").overview, "## Brzi pregled");
  assert.equal(getStructuredPlusLabels("sr").overview, "## Brzi pregled");

  // The word that separates the three, in the place a reader would notice it.
  assert.equal(getStructuredPlusLabels("hr").detailedNotes, "### Detaljne bilješke");
  assert.equal(getStructuredPlusLabels("bs").compare, "### Poređenje");
  assert.equal(getStructuredPlusLabels("sr").detailedNotes, "### Detaljne beleške");
  assert.equal(getStructuredPlusLabels("hr").compare, "### Usporedba");
});

test("an unsupported language still falls back to English furniture", () => {
  assert.equal(getStructuredPlusLabels("fr").overview, "## Quick Overview");
});

test("the callout labels the model is given follow the same language", () => {
  const croatian = buildSourceNoteInstructions({ outputLanguage: "hr" });

  assert.match(croatian, /\*\*Česta pogreška:\*\*/);
  assert.doesNotMatch(croatian, /\*\*Common mistake:\*\*/);

  const serbian = buildSourceNoteInstructions({ outputLanguage: "sr" });

  assert.match(serbian, /\*\*Česta greška:\*\*/);
  assert.doesNotMatch(serbian, /\*\*Pogosta napaka:\*\*/);
});
