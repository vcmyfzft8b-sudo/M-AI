import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const WORKSPACE_SOURCE = readSource("src/components/lecture-workspace.tsx");
const NAVIGATION_SOURCE = readSource("src/components/navigation-loading.tsx");
const NEXT_CONFIG_SOURCE = readSource("next.config.ts");

/*
 * Sentry MEMOAI-WEB-4S (issue 150217107), 2026-09-29T14:37Z: a learner deleted a note from its own
 * action sheet (DELETE 200), landed on the library, and five seconds later the note was still
 * listed. `staleTimes.dynamic` keeps router payloads for a minute, and `deleteNote` navigated home
 * without clearing them, so both the library and the note itself came from before the delete. The
 * note opened, and its every request answered 404: seven more deletes, then the tutor's
 * "Ni najdeno.".
 */

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${signature} is not closed`);
}

test("the router keeps dynamic pages long enough for a deleted note to come back", () => {
  // If this ever goes back to 0 the refresh below is harmless, but the reason for it is gone.
  assert.match(NEXT_CONFIG_SOURCE, /staleTimes:\s*\{\s*dynamic:\s*[1-9]/);
});

test("deleting the note being read leaves with a refresh of the library", () => {
  const body = functionBody(WORKSPACE_SOURCE, "async function deleteNote()");

  assert.match(body, /navigateWithFeedback\(homeHref,\s*\{\s*refresh:\s*true\s*\}\)/);
});

test("a refreshing navigation refreshes on arrival, behind the overlay", () => {
  const body = functionBody(NAVIGATION_SOURCE, "function navigateWithFeedback(");

  // Not before the push: a refresh dispatched ahead of a navigation is discarded by it, and the
  // router kept its copy of the library, so the deleted note was still drawn (preview, 2026-09-29).
  assert.match(body, /refreshOnArrivalRef\.current = options\?\.refresh \? targetPathname : null/);
  assert.match(body, /afterPaint\(\(\) => startRouting\(\(\) => router\.push\(href\)\)\)/);
  assert.doesNotMatch(body.slice(body.indexOf("afterPaint(")), /router\.refresh\(\)/);

  // On arrival the overlay is held while the refresh runs, so the stale copy never shows.
  const release = NAVIGATION_SOURCE.slice(
    NAVIGATION_SOURCE.indexOf("const landedOnTarget ="),
    NAVIGATION_SOURCE.indexOf("function afterPaint("),
  );
  const guard = release.indexOf("if (!landedOnTarget || isArrivalRefreshing)");
  const refresh = release.indexOf("startArrivalRefresh(() => router.refresh())");
  const releaseOverlay = release.indexOf("setPending(null)");

  assert.ok(guard > 0, "the overlay must be held while the arrival refresh runs");
  assert.ok(refresh > guard && refresh < releaseOverlay, "refresh before the overlay is released");
});
