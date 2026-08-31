import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGeneratedContentLanguageInstruction,
  detectSourceLanguage,
} from "../src/lib/languages.ts";

/*
 * Passages long enough to be a paragraph of real notes, which is what the
 * detector actually sees. Slovenian and Croatian are the pair worth caring
 * about: they share most of their common words, so a detector that leans on
 * "je" or "in" will call every Slovenian note Croatian.
 */
const SAMPLES = {
  sl: "Trg deluje kot pogajanje med kupci in prodajalci, ki želijo nizko ceno, prodajalci pa visoko, cena pa se ustali tam, kjer se želena količina nakupa in prodaje ujameta. Ta točka je tržno ravnovesje, zato lahko pri vsaki spremembi nastane novo ravnovesje med ponudbo in povpraševanjem.",
  en: "The market works as a negotiation between buyers and sellers, and the price settles at the point where the quantity that buyers want matches the quantity that sellers offer. This is the equilibrium, which shifts when any factor other than price changes.",
  de: "Der Markt funktioniert wie eine Verhandlung zwischen Käufern und Verkäufern, und der Preis pendelt sich dort ein, wo die gewünschte Menge übereinstimmt. Das ist das Gleichgewicht, das sich auch verschieben kann, wenn sich andere Faktoren nicht ändern.",
  it: "Il mercato funziona come una negoziazione tra acquirenti e venditori, e il prezzo si stabilizza nel punto in cui la quantità desiderata coincide. Questo è l'equilibrio, che non cambia quando anche gli altri fattori sono costanti, come sono descritti.",
  hr: "Tržište funkcionira kao pregovor između kupaca i prodavača, koji žele nisku cijenu, ali se cijena ustali ondje gdje se količine poklope. To je ravnoteža, jer se nakon toga mijenja samo kada se promijeni neki drugi čimbenik, prema onome što vrijedi.",
};

for (const [code, text] of Object.entries(SAMPLES)) {
  test(`a paragraph of ${code} notes is detected as ${code}`, () => {
    assert.equal(detectSourceLanguage(text), code);
  });
}

test("a sample too short to judge is left undecided", () => {
  assert.equal(detectSourceLanguage("Kratko."), null);
  assert.equal(detectSourceLanguage(""), null);
});

test("text with no marker words at all is left undecided", () => {
  // Callers read null as "let the provider work it out", which beats guessing.
  assert.equal(detectSourceLanguage("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu"), null);
});

test("the generation instruction names no language of its own", () => {
  const instruction = buildGeneratedContentLanguageInstruction();

  assert.match(instruction, /same language as the source material/i);
  assert.match(instruction, /do not translate/i);

  // The old instruction named a target language and told the model to
  // translate the source into it. English may still be mentioned — the point
  // is that the model must not drift into it — but never as the target.
  assert.doesNotMatch(
    instruction,
    /material in (English|Slovenian|German|Croatian|Italian)/i,
  );
});
