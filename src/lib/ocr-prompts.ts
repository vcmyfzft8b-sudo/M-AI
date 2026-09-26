// The prompts that read photos and scanned PDFs. Kept pure (no "server-only", no "@/" imports) so
// scripts/replay-failed-note.mjs reads a failed upload with exactly what production uses.

export const IMAGE_OCR_INSTRUCTIONS =
  "Extract all readable text from this photo of notes or printed material. The source is likely Slovenian, so preserve Slovenian characters such as č, š, and ž. Do not translate and do not summarize. Preserve the original language, headings, bullet points, equations, labels, line breaks, and important details. Ignore decorative background elements. If handwriting is uncertain, make the best faithful reading instead of inventing content. If the page is rotated or upside down, read it in its correct orientation. Return only the extracted text. Do not include JSON, markdown fences, commentary, or confidence notes.";

/**
 * The reading we ask for when a verbatim one was withheld. Gemini refuses to copy published text
 * word for word (finishReason RECITATION) -- which is every printed textbook page a learner
 * photographs -- and answers with nothing, on both OCR models, every time. Measured on the
 * 2026-09 failures: two clear textbook pages were rejected as "unreadable" by both verbatim
 * readers and came back complete, in Slovenian, when asked to restate instead of copy. For notes a
 * faithful restatement is as good as a transcript.
 */
export const IMAGE_RESTATE_INSTRUCTIONS =
  "Read this photo of study material (a textbook page, worksheet, handwritten notes, a board or a screen). Write down all of its study content as plain text IN THE SAME LANGUAGE AS THE PAGE (a Slovenian page is written in Slovenian with č, š and ž). Do not copy printed sentences word for word: restate each sentence in your own words, keeping every fact, name, term, number, date, definition, formula, example, heading, list item, label and exercise. Keep the page's order and headings. Say briefly what diagrams, maps and tables show. If the page is rotated, read it in its correct orientation. Do not translate, do not summarize detail away, do not add commentary. Return only the text.";

export const PDF_EXTRACT_INSTRUCTIONS =
  "Extract as much readable text from this PDF as possible into plain text. Do not summarize. Preserve the source language, preserve examples and important details, and ignore repeated headers, footers, and page numbers when possible. Return only the extracted document text. Do not include JSON, markdown fences, commentary, or confidence notes.";

/**
 * Asked for when the verbatim extraction is withheld as a copy of published text (RECITATION):
 * a scanned textbook or magazine is exactly what learners upload, and Gemini refuses to copy it
 * but readily restates it. Measured on a 32-page scanned journal issue that failed as pdf_no_text.
 */
export const PDF_RESTATE_INSTRUCTIONS =
  "Read this whole document and write out all of its study content as plain text, page by page, IN THE SAME LANGUAGE AS THE DOCUMENT (a Slovenian document is written in Slovenian with č, š and ž). Do not copy sentences word for word: restate each one in your own words while keeping every fact, name, term, number, date, definition, formula, example and heading. Say briefly what figures, maps and tables show. Skip covers, imprint pages, repeated headers, footers and page numbers. Do not translate, do not summarize detail away, do not add commentary. Return only the text.";
