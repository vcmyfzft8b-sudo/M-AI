import assert from "node:assert/strict";
import test from "node:test";

import {
  collectHighlightableWords,
  highlightTarget,
  MAX_AI_HIGHLIGHTS,
  pickHighlightRanges,
} from "../src/lib/notes/ai-highlight-ranges.ts";
import { parseNoteTtsDocument } from "../src/lib/note-tts-text.ts";

/*
 * The note highlighter marks key terms where the note defines them (a learner asked for exactly
 * this in the October 2026 survey). These cover the mechanical half: which words may carry a
 * highlight, and where a model's verbatim pick lands.
 */

const NOTE = [
  "## Elastičnost",
  "",
  "Pri ceni se elastičnost pogosto omenja, a jo je treba razumeti.",
  "",
  "**Cenovna elastičnost** meri odzivnost povpraševane količine na spremembo cene.",
  "",
  "> **Definicija:** **Elastičnost** je razmerje med odstotnima spremembama.",
  "",
  "- **Neelastično povpraševanje:** količina se skoraj ne odzove, približno 50 % manj.",
].join("\n");

function wordsOf(markdown) {
  return collectHighlightableWords(parseNoteTtsDocument(markdown).blocks);
}

function textOf(words, range) {
  return words
    .filter((word) => word.index >= range.startWordIndex && word.index <= range.endWordIndex)
    .map((word) => word.text)
    .join(" ");
}

test("headings and a callout's own label are never highlightable, the callout's text is", () => {
  const texts = wordsOf(NOTE).map((word) => word.text);

  // The heading word appears in the body too, but the heading's own occurrence is skipped.
  assert.equal(texts.filter((text) => text === "Elastičnost").length, 1);
  assert.ok(!texts.includes("Definicija"), "the box label is not a key term");
  assert.ok(texts.includes("razmerje"), "the definition inside the box is highlightable");
});

test("a term is highlighted where it is defined, not at an earlier passing mention", () => {
  const words = wordsOf(NOTE);
  const [range] = pickHighlightRanges(
    words,
    [{ term: "Elastičnost", context: "Elastičnost je razmerje med odstotnima spremembama", kind: "term" }],
    MAX_AI_HIGHLIGHTS,
  );

  assert.equal(textOf(words, range), "Elastičnost");
  const passing = words.find((word) => word.text === "elastičnost");
  assert.ok(range.startWordIndex > passing.index, "the passing mention in the first sentence is skipped");
});

test("single words and multi-word terms are both located; a missing context falls back to the first occurrence", () => {
  const words = wordsOf(NOTE);
  const ranges = pickHighlightRanges(
    words,
    [
      { term: "Cenovna elastičnost", context: "Cenovna elastičnost meri odzivnost povpraševane količine", kind: "term" },
      { term: "Neelastično povpraševanje", context: "not in the note at all", kind: "term" },
    ],
    MAX_AI_HIGHLIGHTS,
  );

  assert.deepEqual(
    ranges.map((range) => textOf(words, range)),
    ["Cenovna elastičnost", "Neelastično povpraševanje"],
  );
});

test("each term once, never overlapping, no bare numbers, no sentence-long 'terms'", () => {
  const words = wordsOf(NOTE);
  const ranges = pickHighlightRanges(
    words,
    [
      { term: "Cenovna elastičnost", context: "Cenovna elastičnost meri odzivnost", kind: "term" },
      { term: "cenovna elastičnost", context: "", kind: "term" },
      { term: "elastičnost", context: "Cenovna elastičnost meri", kind: "term" },
      { term: "50", context: "približno 50 % manj", kind: "fact" },
      { term: "meri odzivnost povpraševane količine na spremembo cene", context: "", kind: "term" },
      { term: "približno 50", context: "približno 50 % manj", kind: "fact" },
    ],
    MAX_AI_HIGHLIGHTS,
  );

  assert.deepEqual(
    ranges.map((range) => textOf(words, range)),
    ["Cenovna elastičnost", "približno 50"],
  );
});

test("facts stay a quarter of the highlights, and the total is capped", () => {
  const filler = Array.from({ length: 40 }, (_, index) => `Pojem${index} je razlaga.`).join("\n\n");
  const words = wordsOf(filler);
  const picks = Array.from({ length: 40 }, (_, index) => ({
    term: `Pojem${index}`,
    context: `Pojem${index} je razlaga`,
    kind: index % 2 === 0 ? "fact" : "term",
  }));
  const ranges = pickHighlightRanges(words, picks, 8);

  assert.equal(ranges.length, 8);
  const facts = ranges.filter((range) => {
    const index = Number(textOf(words, range).replace("Pojem", ""));
    return index % 2 === 0;
  });
  assert.equal(facts.length, 2);
});

test("the number asked for grows with the note and stops at the cap", () => {
  assert.equal(highlightTarget(120), 4);
  assert.equal(highlightTarget(650), 7);
  assert.equal(highlightTarget(5000), MAX_AI_HIGHLIGHTS);
});
