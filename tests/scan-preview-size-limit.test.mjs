import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAX_SCAN_IMAGE_BYTES,
  MAX_SCAN_PREVIEW_BYTES,
} from "../src/lib/constants.ts";
import { canConvertScanPreview } from "../src/lib/scan-preview.ts";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/**
 * A HEIC photo takes two different routes out of the browser, and they do not have
 * the same ceiling.
 *
 * The photo itself is uploaded straight to storage with a signed URL, so it may be
 * as large as MAX_SCAN_IMAGE_BYTES. Its thumbnail is not: the raw photo is posted to
 * a Vercel function to be converted, and the platform refuses a request body over
 * 4.5 MB with a 413 before the route ever runs. A photo in the gap between the two
 * limits therefore uploads fine but could never be previewed, and asking for the
 * preview anyway produced a failed request per attempt and a Sentry error per
 * failure, on a photo that was going to work.
 */

/**
 * Vercel rejects a serverless function request body above this. Not ours to raise.
 *
 * It is 4.5 MB in decimal, not 4.5 MiB: measured on the preview for #313, a
 * 4,480,000-byte body reaches the route and gets its 422, a 4,510,000-byte body
 * gets the platform's 413 before the route runs.
 */
const VERCEL_FUNCTION_BODY_LIMIT_BYTES = 4_500_000;

const MB = 1024 * 1024;

test("the preview limit stays under the platform body limit, with multipart headroom", () => {
  assert.ok(
    MAX_SCAN_PREVIEW_BYTES < VERCEL_FUNCTION_BODY_LIMIT_BYTES,
    "a preview request at the limit has to survive the platform, not just the route",
  );

  // The body is multipart: the photo plus a boundary and part headers. Leave at least
  // as much room for that framing as the PDF upload route does.
  assert.ok(
    VERCEL_FUNCTION_BODY_LIMIT_BYTES - MAX_SCAN_PREVIEW_BYTES >= 256 * 1024,
    "multipart framing must not be able to push a legal photo over the platform limit",
  );
});

test("a photo can be too large to preview yet still small enough to upload", () => {
  assert.ok(
    MAX_SCAN_PREVIEW_BYTES < MAX_SCAN_IMAGE_BYTES,
    "the gap is the whole point: these two limits are not the same number",
  );

  // The photo from the production report: a 6 MB HEIC picked on Android Chrome.
  assert.equal(canConvertScanPreview(6 * MB), false);

  // ...but it is still a perfectly good photo to make a note out of.
  assert.ok(6 * MB <= MAX_SCAN_IMAGE_BYTES);
});

test("canConvertScanPreview accepts the sizes that can actually be converted", () => {
  assert.equal(canConvertScanPreview(1), true);
  assert.equal(canConvertScanPreview(2 * MB), true);
  assert.equal(canConvertScanPreview(MAX_SCAN_PREVIEW_BYTES), true);

  assert.equal(canConvertScanPreview(MAX_SCAN_PREVIEW_BYTES + 1), false);
  assert.equal(canConvertScanPreview(MAX_SCAN_IMAGE_BYTES), false);

  // An empty pick is not a preview candidate either.
  assert.equal(canConvertScanPreview(0), false);
  assert.equal(canConvertScanPreview(-1), false);
});

test("the modal checks the size before it posts the photo, not after", () => {
  const source = read("../src/components/note-source-modal.tsx");
  const previewFunction = source.slice(
    source.indexOf("async function prepareHeicPhotoPreview("),
  );

  assert.ok(
    previewFunction.indexOf("async function prepareHeicPhotoPreview(") >= 0,
    "prepareHeicPhotoPreview should still exist",
  );

  const guardIndex = previewFunction.indexOf("canConvertScanPreview(");
  const requestIndex = previewFunction.indexOf('"/api/scan-preview"');

  assert.ok(guardIndex >= 0, "the preview path must consult the preview size limit");
  assert.ok(requestIndex >= 0, "the preview path should still call the route");
  assert.ok(
    guardIndex < requestIndex,
    "the size check has to happen before the request, or the 413 already happened",
  );
});

test("the route rejects an oversized photo on the same limit the client uses", () => {
  const source = read("../src/app/api/scan-preview/route.ts");

  assert.ok(
    source.includes("canConvertScanPreview("),
    "client and route must agree on what is previewable",
  );
  assert.ok(
    !source.includes("MAX_SCAN_IMAGE_BYTES"),
    "the upload limit is unreachable here: the platform rejects the body long before it",
  );
});
