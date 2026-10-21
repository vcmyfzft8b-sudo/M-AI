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

/** Fewer words than this in the whole layer is too little to be the document. */
const MIN_TEXT_LAYER_WORDS = 40;

/**
 * A page of study material holds sentences; a layer averaging fewer words than this a page is
 * the furniture printed around scanned or pasted-in pages (dates, page numbers, a running head).
 */
const MIN_TEXT_LAYER_WORDS_PER_PAGE = 8;

/**
 * Whether a PDF's embedded text layer is the document, or the reader must look at the pages.
 *
 * Only words with a letter in them count. A handout of slide pictures printed with a date and page
 * numbers in its header has a perfectly legible layer of ~70 "words" ("5. 10. 2026 1 1 2" a page),
 * which the word count took as the document, and the note failed as too short with the slides
 * never read (note triage, lectures 83c02ac7 and 4dde789e: 12 pages, 241 characters). Such a layer
 * goes to the OCR reader instead; a sparse but real layer only costs an OCR read.
 */
export function isPdfTextLayerTheDocument(params: { text: string; pageCount: number }) {
  const words = params.text.split(/\s+/u).filter((word) => /\p{L}/u.test(word)).length;

  return (
    words >= MIN_TEXT_LAYER_WORDS &&
    words >= MIN_TEXT_LAYER_WORDS_PER_PAGE * Math.max(1, params.pageCount) &&
    isLegiblePdfTextLayer(params.text)
  );
}
