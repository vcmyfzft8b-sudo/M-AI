/**
 * Whether a PDF's embedded text layer reads as text, or is the glyph codes of a font with no
 * Unicode mapping.
 *
 * A PDF whose fonts carry no ToUnicode table hands PDF.js the raw glyph numbers, which come out as
 * control characters and stray punctuation ("\u0001 \u0002 \u0003 ! \" #"). It has plenty of
 * "words", so the word count alone took it as the document, and the note stage found nothing to
 * learn in it (note triage, lecture 47e2d7b6: a 27-page statute, ~1% letters). Such a layer must go
 * to the OCR reader instead, which reads the rendered pages.
 *
 * Real text in any script is mostly letters and digits, and never contains control characters. A
 * formula-heavy page that dips below the bar only costs an OCR read; a garbled layer let through
 * costs the learner their note, so the bar leans towards the reader.
 *
 * Kept free of imports so scripts/replay-failed-note.mjs applies the same rule production does.
 */
export function isLegiblePdfTextLayer(text: string) {
  const characters = [...text.replace(/\s+/gu, "")];

  if (characters.length === 0) {
    return false;
  }

  const letters = characters.filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
  const glyphCodes = characters.filter((character) => /[\p{Cc}\p{Co}�]/u.test(character)).length;

  return letters / characters.length >= 0.4 && glyphCodes / characters.length <= 0.05;
}
