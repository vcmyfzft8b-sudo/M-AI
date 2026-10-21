/**
 * A Word document whose study content is a picture: a diagram, a scanned page or a photographed
 * worksheet pasted onto an otherwise empty page. Its text is empty, so the raw-text reader found
 * nothing and the note failed as too short with the picture never looked at (note triage, lectures
 * 6eb2e4a0 and 8a50f10e: one labelled music diagram and no text at all).
 *
 * Kept free of imports so the rules are testable on their own.
 */

/** Fewer words than this and the pictures are read too; a page of text is well above it. */
const MIN_DOCX_TEXT_WORDS = 40;

/** The formats the photo reader accepts; anything else (EMF, WMF, SVG) is skipped. */
export const DOCX_PICTURE_MIME_BY_EXTENSION: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Whether a Word document's text is too thin to be the document on its own. */
export function docxTextNeedsPictures(text: string) {
  return text.split(/\s+/u).filter((word) => /\p{L}/u.test(word)).length < MIN_DOCX_TEXT_WORDS;
}

/**
 * The pictures of `word/document.xml`, as zip paths in the order they appear on the page, each
 * once. Headers, footers and unused media are not in the body and are left out.
 */
export function orderDocxPicturePaths(params: { documentXml: string; relsXml: string }) {
  const targetById = new Map<string, string>();

  for (const match of params.relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];

    if (id && target && /\/image"/.test(tag) && !/TargetMode="External"/.test(tag)) {
      targetById.set(id, `word/${target.replace(/^\.?\//, "")}`);
    }
  }

  const paths: string[] = [];

  for (const match of params.documentXml.matchAll(/\br:(?:embed|id)="([^"]+)"/g)) {
    const path = targetById.get(match[1]);
    const extension = path?.split(".").pop()?.toLowerCase() ?? "";

    if (path && DOCX_PICTURE_MIME_BY_EXTENSION[extension] && !paths.includes(path)) {
      paths.push(path);
    }
  }

  return paths;
}
