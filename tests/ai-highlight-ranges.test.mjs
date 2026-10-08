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
 * The note highlighter marks the key words inside the definitions of a note's most important
 * concepts (a learner asked for exactly this in the October 2026 survey). These cover the
 * mechanical half: which words may carry a highlight, and where a model's verbatim pick lands.
 */

const NOTE = [
  "## Celica",
  "",
  "O celici se pogosto govori, a je najmanjša enota tudi v vsakdanjem pomenu.",
  "",
  "> **Definicija:** **Celica** je najmanjša zgradbena in delovna enota živega bitja.",
  "",
  "- **Mitoza:** delitev, pri kateri nastaneta dve hčerinski celici z enakim številom kromosomov.",
  "- **Mejoza:** delitev, pri kateri nastanejo spolne celice s polovičnim številom kromosomov.",
].join("\n");

function wordsOf(markdown) {
  return collectHighlightableWords(parseNoteTtsDocument(markdown).blocks);
}

function textsOf(words, ranges) {
  return ranges.map((range) =>
    words
      .filter((word) => word.index >= range.startWordIndex && word.index <= range.endWordIndex)
      .map((word) => word.text)
      .join(" "),
  );
}

test("headings and a callout's own label are never highlightable, the definition inside is", () => {
  const texts = wordsOf(NOTE).map((word) => word.text);

  assert.ok(!texts.includes("Definicija"), "the box label is not part of any definition");
  assert.equal(texts.filter((text) => text === "Celica").length, 1, "the heading's word is skipped");
  assert.ok(texts.includes("zgradbena"), "the definition inside the box is highlightable");
});

test("the key words are highlighted inside the definition, not at an earlier passing mention", () => {
  const words = wordsOf(NOTE);
  const ranges = pickHighlightRanges(
    words,
    [
      {
        concept: "Celica",
        keywords: "najmanjša zgradbena in delovna enota",
        context: "Celica je najmanjša zgradbena in delovna enota živega bitja",
      },
    ],
    MAX_AI_HIGHLIGHTS,
  );

  assert.deepEqual(textsOf(words, ranges), ["najmanjša zgradbena in delovna enota"]);
  const passing = words.find((word) => word.text === "najmanjša");
  assert.ok(ranges[0].startWordIndex > passing.index, "the passing sentence is skipped");
});

test("a context that misses still places multi-word key words at their first occurrence", () => {
  const words = wordsOf(NOTE);
  const ranges = pickHighlightRanges(
    words,
    [
      { concept: "Mitoza", keywords: "dve hčerinski celici z enakim številom kromosomov", context: "not in the note" },
      // The context exists but is another sentence (the neighbouring table cell).
      { concept: "Mejoza", keywords: "s polovičnim številom kromosomov", context: "Celica je najmanjša zgradbena" },
    ],
    MAX_AI_HIGHLIGHTS,
  );

  assert.deepEqual(textsOf(words, ranges), [
    "dve hčerinski celici z enakim številom kromosomov",
    "s polovičnim številom kromosomov",
  ]);
});

test("never a single word, the concept's own name, a bare number, a second pick for one concept, or an overlap", () => {
  const words = wordsOf(NOTE);
  const ranges = pickHighlightRanges(
    words,
    [
      { concept: "Celica", keywords: "Celica", context: "Celica je najmanjša zgradbena" },
      { concept: "Mitoza", keywords: "delitev", context: "Mitoza delitev pri kateri nastaneta" },
      { concept: "Mitoza", keywords: "dve hčerinski celici", context: "nastaneta dve hčerinski celici z enakim" },
      { concept: "Mitoza", keywords: "z enakim številom kromosomov", context: "celici z enakim številom kromosomov" },
      { concept: "Celična delitev", keywords: "hčerinski celici z enakim", context: "dve hčerinski celici z enakim številom" },
      { concept: "Kromosomi", keywords: "46", context: "ima 46 kromosomov" },
    ],
    MAX_AI_HIGHLIGHTS,
  );

  assert.deepEqual(textsOf(words, ranges), ["dve hčerinski celici"]);
});

test("the total is capped", () => {
  const filler = Array.from({ length: 30 }, (_, index) => `Pojem${index} je razlaga številka ${index}.`).join("\n\n");
  const words = wordsOf(filler);
  const picks = Array.from({ length: 30 }, (_, index) => ({
    concept: `Pojem${index}`,
    keywords: `razlaga številka ${index}`,
    context: `Pojem${index} je razlaga številka ${index}`,
  }));

  assert.equal(pickHighlightRanges(words, picks, 8).length, 8);
});

test("the number of concepts asked for is five to ten, growing with the note", () => {
  assert.equal(highlightTarget(120), 5);
  assert.equal(highlightTarget(650), 7);
  assert.equal(highlightTarget(5000), MAX_AI_HIGHLIGHTS);
  assert.equal(MAX_AI_HIGHLIGHTS, 10);
});
