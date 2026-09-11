import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The HEIC thumbnail the creator demo asked an offline stub to convert.
 *
 * No browser outside Safari decodes HEIC, so a picked `.heic` photo has its
 * thumbnail made by posting the raw file to `/api/scan-preview`, a Vercel
 * function that answers with `image/jpeg` bytes. The creator demo has no such
 * function: it swaps `window.fetch` for `createCreatorDemoFetch`, which answers
 * every route it does not implement with `json({ ok: true })` so that a stray
 * background call can never put an error banner into somebody's recording.
 *
 * A thumbnail request is not a stray background call. It read the catch-all
 * back as `response.ok`, then found `application/json` where it wanted an
 * image, threw "the preview could not be read" and reported it to Sentry from a
 * public marketing page — once per HEIC photo dropped into the demo.
 *
 * Converting HEIC needs a server, which is the one thing an offline demo does
 * not have, so the fix is the one the size guard beside it already makes: show
 * "no preview" without the round trip. The photo is unaffected either way — in
 * the demo it never leaves the browser at all.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const demoApi = read("../src/lib/creator-demo/api.ts");
const modal = read("../src/components/note-source-modal.tsx");

/** The body of a `function <name>(` declaration, matched by brace depth. */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} has been renamed or removed`);

  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;

  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(open, index + 1);
      }
    }
  }

  throw new Error(`${name} is unbalanced`);
}

test("the demo API has no answer for the scan preview route", () => {
  const request = functionBody(demoApi, "handleDemoRequest");

  assert.ok(
    !/case "scan-preview"/.test(request),
    "the demo can now answer the preview route — if it returns real image bytes this guard " +
      "is obsolete, and if it does not, check what it returns before restoring the round trip",
  );

  // `json` defaults to 200, so the catch-all is an ok response carrying JSON:
  // the exact shape the modal's image check rejects.
  const fallback = request.slice(request.lastIndexOf("default:"));

  assert.match(
    fallback,
    /return json\(\{ ok: true \}\)/,
    "the catch-all is what made a missing preview case look like success",
  );
  assert.match(demoApi, /function json\(body: unknown, status = 200\)/);
});

test("an ok response that is not an image is still treated as a failure", () => {
  // Guards the check that turned the catch-all into a Sentry defect. It has to
  // keep throwing: in the real app a non-image 200 means the conversion really
  // did go wrong, and that is worth hearing about.
  assert.match(
    modal,
    /if \(!previewBlob\.type\.startsWith\("image\/"\)\) \{\s*throw new Error\(t\("capture\.error\.previewUnreadable"\)\);/,
    "the throw that reported the demo's catch-all to Sentry has moved",
  );
});

test("the creator demo does not ask for a converted preview at all", () => {
  const prepare = functionBody(modal, "prepareHeicPhotoPreview");
  const guard = prepare.slice(0, prepare.indexOf("fetchWithTimeout"));

  assert.ok(
    guard.includes("isCreatorDemo"),
    "the demo would post a HEIC photo to a route its own stub answers with JSON",
  );

  // The skip is only worth anything if it lands on the same quiet "no preview"
  // the size guard produces, rather than an error the recording would show.
  assert.match(
    guard,
    /if \(isCreatorDemo \|\| !canConvertScanPreview\(photoSource\.file\.size\)\) \{\s*setPhotoSources\(\(current\) =>[\s\S]*?previewStatus: "failed"[\s\S]*?return;/,
    "the demo skip has to reuse the size guard's silent fallback",
  );
});

test("the real app still converts HEIC through the route", () => {
  const prepare = functionBody(modal, "prepareHeicPhotoPreview");

  // Guards the fix against overshooting: outside the demo the round trip is the
  // only way a non-Safari browser gets a HEIC thumbnail.
  assert.match(prepare, /fetchWithTimeout\("\/api\/scan-preview"/);
  assert.match(prepare, /previewStatus: "ready"/);
});
