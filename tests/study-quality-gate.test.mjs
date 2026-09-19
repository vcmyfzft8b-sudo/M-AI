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
