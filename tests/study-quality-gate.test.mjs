import assert from "node:assert/strict";
import test from "node:test";

import {
  dependsOnMissingStudyContext,
  isHighQualityStudyPrompt,
} from "../src/lib/study-quality.ts";

/**
 * The gate that keeps unanswerable questions out of a deck, held to the languages it actually
 * runs in.
 *
 * It reads generated question text, which is written in the language of whatever the student
 * uploaded — so "the languages we ship the interface in" was never the right target, and the
 * phrase list was written against English and Slovenian only. Measured on the labelled set in
 * scripts/jev-eval.mjs, that list scored 0.62 and let eleven of fourteen broken questions
 * through; with the structural rules it scores 1.00 and drops none of the good ones.
 *
 * The broken cases below are the ones that were reaching real decks. The good cases are the
 * reason the rules key on shape rather than vocabulary — every one of them contains a word the
 * naive version of this rule would have banned.
 */

const BROKEN = [
  // English shapes nobody had added.
  "Summarise what the table on the previous page lists.",
  "Which of these did the lecturer say was most important?",
  "Describe what is shown in figure 2.",
  // Slovenian: a numbered figure, and a scheme on a page the student cannot turn to.
  "Kaj prikazuje slika 3.1?",
  "Opišite shemo na prejšnji strani.",
  "Kaj je o tem povedal predavatelj?",
  // Polish and Croatian/Bosnian/Serbian: entirely uncovered before.
  "Co przedstawia rysunek 3.2 w tym rozdziale?",
  "Opisz tabelę powyżej.",
  "Što je prikazano na slici iznad?",
  "Objasnite dijagram sa prethodne stranice.",
  "Što je profesor rekao o ovoj temi?",
  "Na temelju tablice 4.2, izracunajte prosjek.",
];

/**
 * Every one of these mentions a figure, a table, a chapter, a page or an author, and every one is
 * a question a student can answer from memory. They are the precision half of the measurement: a
 * gate that protects the deck by emptying it has not helped anyone.
 */
const GOOD = [
  "Who was the author of the Communist Manifesto?",
  "What is a chart of accounts used for?",
  "Kaj je tabela obveznosti v bilanci stanja?",
  "Kako se imenuje slika, naslikana na sveže omet?",
  "Katero poglavje Obligacijskega zakonika ureja prodajno pogodbo?",
  "Czym jest rysunek techniczny?",
  "Koje su tri osnovne vrste grafova u teoriji grafova?",
  "Objasnite razliku između TCP-a i UDP-a.",
  "What is the function of the synaptic cleft?",
  "Navedite tri plasti modela OSI in njihovo vlogo.",
  /*
   * These were already being dropped before any of this, by an unbounded `.*` that rejected any
   * English "what is" question containing "table", "image", "figure" or "example" anywhere in it.
   * A relational-database course could not get a question about tables into its own deck.
   */
  "What is a table in a relational database?",
  "What is an image sensor?",
  "What is the diagram method used for in project planning?",
];

test("a question that points at material it does not contain is rejected", () => {
  for (const prompt of BROKEN) {
    assert.equal(isHighQualityStudyPrompt(prompt), false, `should have been rejected: ${prompt}`);
  }
});

test("a question that merely mentions a figure, page or author is kept", () => {
  for (const prompt of GOOD) {
    assert.equal(isHighQualityStudyPrompt(prompt), true, `should have been kept: ${prompt}`);
  }
});

test("a numbered figure reference is a pointer; a bare noun is a subject", () => {
  // The number is what makes matching on the noun alone safe, in any language.
  assert.equal(dependsOnMissingStudyContext("Kaj prikazuje slika 3.1?"), true);
  assert.equal(dependsOnMissingStudyContext("Kako nastane slika v očesu?"), false);
  assert.equal(dependsOnMissingStudyContext("Describe what is shown in figure 2."), true);
  assert.equal(dependsOnMissingStudyContext("What is an image sensor?"), false);
  // The definite reference is the defect, not the noun: "the diagram" points, "a diagram" does not.
  assert.equal(dependsOnMissingStudyContext("What does the diagram show?"), true);
});

test("naming the lecturer only fails when the answer depends on what they said", () => {
  assert.equal(dependsOnMissingStudyContext("Što je profesor rekao o ovoj temi?"), true);
  assert.equal(dependsOnMissingStudyContext("Kaj je o tem povedal predavatelj?"), true);
  // A question *about* an author is a perfectly ordinary exam question.
  assert.equal(dependsOnMissingStudyContext("Who was the author of the Communist Manifesto?"), false);
  assert.equal(dependsOnMissingStudyContext("Kdo je avtor Krsta pri Savici?"), false);
});

test("the rules survive diacritics, which an ASCII word boundary does not", () => {
  // /\bpowyżej\b/ does not mean what it looks like it means: \b is defined over ASCII word
  // characters, so the boundary falls inside the word. Every rule here uses \p{L} lookarounds.
  assert.equal(dependsOnMissingStudyContext("Opisz tabelę powyżej."), true);
  assert.equal(dependsOnMissingStudyContext("Što je prikazano na slici iznad?"), true);
  assert.equal(dependsOnMissingStudyContext("Opišite shemo na prejšnji strani."), true);
});

test("the whole labelled set, as one number", () => {
  const correct =
    BROKEN.filter((prompt) => !isHighQualityStudyPrompt(prompt)).length +
    GOOD.filter((prompt) => isHighQualityStudyPrompt(prompt)).length;

  assert.equal(correct, BROKEN.length + GOOD.length);
});

test("a numbered chapter, page or table is a citation, not a dangling pointer", () => {
  /*
   * The first cut of the numbered rule treated any noun-plus-number as a reference to absent
   * material, which is right for pictures and wrong for everything else: nobody writes "figure
   * 3.1" about a figure the reader can already see, but citing chapter 3 of a statute or naming
   * first normal form is ordinary subject matter. A law course lost every question it had.
   */
  assert.equal(dependsOnMissingStudyContext("Kaj ureja poglavje 3 Zakona o delovnih razmerjih?"), false);
  assert.equal(dependsOnMissingStudyContext("What does chapter 4 of the Civil Code regulate?"), false);
  assert.equal(dependsOnMissingStudyContext("What is Table 1 normal form in database design?"), false);
  assert.equal(dependsOnMissingStudyContext("Na kateri strani periodnega sistema so halogeni?"), false);

  // A picture with a number stays a pointer whatever follows it.
  assert.equal(dependsOnMissingStudyContext("Kaj prikazuje slika 3.1 v tem poglavju?"), true);
  // And a location noun is one when the number closes the phrase it is being read off.
  assert.equal(dependsOnMissingStudyContext("Na temelju tablice 4.2, izracunajte prosjek."), true);
});

test("a word that is half of a direction is not a pointer", () => {
  /*
   * Slovenian builds "od spodaj navzgor" (from the bottom upwards) out of the same token as
   * "below", and the bare /\bspodaj\b/ rejected a perfectly ordinary question asking for the
   * order of the OSI layers. Found in a real generated deck on staging, not in a fixture.
   */
  assert.equal(dependsOnMissingStudyContext("Katero je pravilno vrstni red plasti modela OSI od spodaj navzgor?"), false);
  assert.equal(dependsOnMissingStudyContext("Naštejte plasti modela OSI od zgoraj navzdol."), false);

  // A genuine pointer still is one.
  assert.equal(dependsOnMissingStudyContext("Kot je prikazano spodaj, kaj se zgodi?"), true);
  assert.equal(dependsOnMissingStudyContext("Opišite shemo zgoraj."), true);
});

test("\"the source\" is only a dependency when the answer has to read it", () => {
  // /\bthe source\b/ rejected "the source of an effect", which is what the word usually means in
  // a lecture. Also from a real deck.
  assert.equal(dependsOnMissingStudyContext("Which statement correctly describes the source of a synapse's excitatory effect?"), false);
  assert.equal(dependsOnMissingStudyContext("What is the source of an action potential?"), false);

  assert.equal(dependsOnMissingStudyContext("What does the source say about inflation?"), true);
  assert.equal(dependsOnMissingStudyContext("According to the source, what happened?"), true);
});
