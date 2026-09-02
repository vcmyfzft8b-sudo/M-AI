/*
 * Whether a picked photo can be turned into a thumbnail at all.
 *
 * A HEIC photo leaves the browser twice, by two routes with two different ceilings.
 * The photo itself goes straight to storage through a signed upload URL, so it may
 * be as large as MAX_SCAN_IMAGE_BYTES. Its thumbnail cannot take that route: no
 * browser outside Safari decodes HEIC, so the raw photo is posted to a Vercel
 * function to be converted, and the platform refuses a request body over 4.5 MB
 * with a 413 before the route runs.
 *
 * That leaves a gap — a photo big enough to fail the preview and small enough to
 * make a perfectly good note — and the rule lives out here so both sides of the
 * request agree on where the gap starts.
 */

import { MAX_SCAN_PREVIEW_BYTES } from "./constants.ts";

export function canConvertScanPreview(size: number) {
  return size > 0 && size <= MAX_SCAN_PREVIEW_BYTES;
}
