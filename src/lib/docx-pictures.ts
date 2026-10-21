/**
 * A Word document whose study content is a picture: a diagram, a scanned page or a photographed
 * worksheet pasted onto an otherwise empty page. Its text is empty, so the raw-text reader found
 * nothing and the note failed as too short with the picture never looked at (note triage, lectures
 * 6eb2e4a0 and 8a50f10e: one labelled music diagram and no text at all).
 *
 * A picture can also be a Windows metafile (EMF): Word pastes a copied page or text box as one,
 * and its text is drawn as text records, not pixels. The photo reader cannot open the format, so
 * the text is taken from those records instead (note triage, lecture f028ac0c: a page of school
 * notes pasted as a single EMF picture, no text around it).
 *
 * Kept free of imports so the rules are testable on their own.
 */

/** Fewer words than this and the pictures are read too; a page of text is well above it. */
const MIN_DOCX_TEXT_WORDS = 40;

/** The formats the photo reader accepts. */
export const DOCX_PICTURE_MIME_BY_EXTENSION: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Pictures whose text is read from the file itself rather than by the photo reader. */
export const DOCX_TEXT_PICTURE_EXTENSIONS = new Set(["emf"]);

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
      // Relative to word/ ("media/image1.png"), or absolute from the package root
      // ("/word/media/image1.png"), which some generators write.
      targetById.set(
        id,
        target.startsWith("/") ? target.slice(1) : `word/${target.replace(/^\.\//, "")}`,
      );
    }
  }

  const paths: string[] = [];

  for (const match of params.documentXml.matchAll(/\br:(?:embed|id)="([^"]+)"/g)) {
    const path = targetById.get(match[1]);
    const extension = path?.split(".").pop()?.toLowerCase() ?? "";

    if (
      path &&
      (DOCX_PICTURE_MIME_BY_EXTENSION[extension] || DOCX_TEXT_PICTURE_EXTENSIONS.has(extension)) &&
      !paths.includes(path)
    ) {
      paths.push(path);
    }
  }

  return paths;
}

const EMR_EOF = 14;
const EMR_EXTTEXTOUTW = 84;

/**
 * The text an EMF picture draws, a line per baseline, in the order it is drawn. Only the UTF-16
 * text records (`EMR_EXTTEXTOUTW`, what Word and every current Office writes) are read; a file
 * that is not an EMF, or is cut short, yields what was read before the damage.
 */
export function readEmfText(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EMR_HEADER is record type 1 and carries " EMF" at offset 40.
  if (
    bytes.byteLength < 44 ||
    view.getUint32(0, true) !== 1 ||
    view.getUint32(40, true) !== 0x464d4520
  ) {
    return "";
  }

  const decoder = new TextDecoder("utf-16le");
  const lines: string[] = [];
  let line = "";
  let lineY: number | null = null;
  let offset = 0;

  while (offset + 8 <= bytes.byteLength) {
    const type = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);

    if (size < 8 || size % 4 !== 0 || offset + size > bytes.byteLength || type === EMR_EOF) {
      break;
    }

    // Type, size, bounds (16), graphics mode, x and y scale, then EMRTEXT: reference point,
    // character count and the string's offset from the start of the record.
    if (type === EMR_EXTTEXTOUTW && size >= 76) {
      const y = view.getInt32(offset + 40, true);
      const count = view.getUint32(offset + 44, true);
      const start = view.getUint32(offset + 48, true);

      if (count > 0 && start + count * 2 <= size) {
        const run = decoder
          .decode(bytes.subarray(offset + start, offset + start + count * 2))
          .replace(/[\u0000-\u001f]/g, " ");

        if (lineY !== null && y !== lineY) {
          lines.push(line);
          line = "";
        }

        line += run;
        lineY = y;
      }
    }

    offset += size;
  }

  lines.push(line);

  return lines
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
