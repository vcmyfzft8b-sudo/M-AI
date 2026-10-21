import assert from "node:assert/strict";
import test from "node:test";

import {
  isLegiblePdfTextLayer,
  isPdfTextLayerTheDocument,
  isPdfTextLayerWorthKeeping,
} from "../src/lib/pdf-text-layer.ts";

test("a real text layer is taken as the document", () => {
  assert.equal(
    isLegiblePdfTextLayer(
      "1. člen (vsebina zakona) (1) Ta zakon ureja pravice in obveznosti zavezancev za davek.",
    ),
    true,
  );
  assert.equal(isLegiblePdfTextLayer("Photosynthesis converts light energy into chemical energy."), true);
  assert.equal(isLegiblePdfTextLayer("Фотосинтез — это процесс образования органических веществ."), true);
  assert.equal(isLegiblePdfTextLayer("光合作用是植物利用光能的过程。"), true);
  assert.equal(isLegiblePdfTextLayer("Table 2: 2019 14,5 % 2020 15,1 % 2021 16,0 %"), true);
});

// Note triage, lecture 47e2d7b6: a statute whose fonts carry no Unicode mapping. PDF.js returned
// the glyph codes, ~1% letters, and the note stage found nothing to learn in them.
test("glyph codes from a font with no Unicode mapping go to the reader", () => {
  const glyphCodes = Array.from({ length: 400 }, (_, index) =>
    String.fromCharCode(1 + (index % 30)),
  ).join(" ");
  assert.equal(isLegiblePdfTextLayer(glyphCodes), false);
  assert.equal(isLegiblePdfTextLayer(`\u0001 \u0002 ! " # $ % & ' ( ) * + , - . / 0 1 2`), false);
  assert.equal(isLegiblePdfTextLayer("��� ��"), false);
});

test("an empty layer is not legible", () => {
  assert.equal(isLegiblePdfTextLayer(""), false);
  assert.equal(isLegiblePdfTextLayer("   \n "), false);
});

// Note triage, lectures 83c02ac7 and 4dde789e: a 12-page handout of slide pictures whose only text
// was the date and page numbers printed around them. Legible, ~70 "words", and nothing to learn.
test("a layer of dates and page numbers sends the pages to the reader", () => {
  const furniture = Array.from(
    { length: 12 },
    (_, index) => `5. 10. 2026 ${index + 1} ${index * 2 + 1} ${index * 2 + 2}`,
  ).join("\n\n");

  assert.equal(isLegiblePdfTextLayer(furniture), true);
  assert.equal(isPdfTextLayerTheDocument({ text: furniture, pageCount: 12 }), false);
});

test("a running head over scanned pages sends the pages to the reader", () => {
  const runningHead = Array.from(
    { length: 30 },
    (_, index) => `Uvod v ekonomiko podjetja ${index + 1}`,
  ).join("\n\n");

  assert.equal(isPdfTextLayerTheDocument({ text: runningHead, pageCount: 30 }), false);
});

test("a real text layer is the document", () => {
  const page =
    "Podjetje je organizacija, ki z združevanjem proizvodnih dejavnikov ustvarja proizvode in storitve za trg. Njegov cilj je dolgoročno uspešno poslovanje.";
  const text = Array.from({ length: 4 }, () => page).join("\n\n");

  assert.equal(isPdfTextLayerTheDocument({ text, pageCount: 4 }), true);
  // Too little to be the document, however legible.
  assert.equal(isPdfTextLayerTheDocument({ text: page, pageCount: 1 }), false);
});

test("a running head is kept for when the pages read as nothing; dates and numbers are not", () => {
  const runningHead = Array.from(
    { length: 30 },
    (_, index) => `Uvod v ekonomiko podjetja ${index + 1}`,
  ).join("\n\n");
  const furniture = Array.from(
    { length: 12 },
    (_, index) => `5. 10. 2026 ${index + 1} ${index * 2 + 1} ${index * 2 + 2}`,
  ).join("\n\n");

  assert.equal(isPdfTextLayerWorthKeeping(runningHead), true);
  assert.equal(isPdfTextLayerWorthKeeping(furniture), false);
  assert.equal(isPdfTextLayerWorthKeeping(""), false);
});
