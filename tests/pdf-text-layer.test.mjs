import assert from "node:assert/strict";
import test from "node:test";

import { isLegiblePdfTextLayer } from "../src/lib/pdf-text-layer.ts";

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
