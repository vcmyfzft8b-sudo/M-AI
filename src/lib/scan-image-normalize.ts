import "server-only";

import sharp from "sharp";

/**
 * The longest side a photo is read at. Phone cameras deliver 4000-6000 px; OCR reads a page just
 * as well at this size, and the smaller file uploads to the model faster.
 */
const OCR_IMAGE_MAX_EDGE_PX = 3072;

function isHeicImage(file: File) {
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();

  return (
    type === "image/heic" ||
    type === "image/heif" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

/**
 * Turns an uploaded photo into an upright, reasonably sized JPEG before it is read.
 *
 * Uploads arrive exactly as the phone took them: HEIC from iPhones, and a camera orientation that
 * lives only in the EXIF tag, so a page held sideways reaches the model sideways and the reader
 * describes the rotation instead of reading the page (seen on the 2026-09 failures). Applying the
 * EXIF rotation here fixes that for every photo, whatever the client did.
 *
 * Never fatal: a photo this cannot decode is handed on untouched, and the reader gets its chance.
 */
export async function normalizeScanImageForOcr(file: File): Promise<File> {
  try {
    let input = Buffer.from(await file.arrayBuffer());

    if (isHeicImage(file)) {
      // Loaded only for an iPhone photo: the decoder is a large WebAssembly bundle, and this module
      // sits under the job queue that almost every lecture route imports.
      const { default: convert } = await import("heic-convert");
      input = Buffer.from(await convert({ buffer: input, format: "JPEG", quality: 0.9 }));
    }

    const output = await sharp(input, { failOn: "none" })
      .rotate()
      .resize({
        width: OCR_IMAGE_MAX_EDGE_PX,
        height: OCR_IMAGE_MAX_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    const baseName = (file.name || "photo").replace(/\.[^.]+$/, "");

    return new File([new Uint8Array(output)], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
