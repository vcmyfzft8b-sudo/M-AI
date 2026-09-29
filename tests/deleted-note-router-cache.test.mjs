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

test("deleting the note being read leaves with the router cache cleared", () => {
  const body = functionBody(WORKSPACE_SOURCE, "async function deleteNote()");

  assert.match(body, /navigateWithFeedback\(homeHref,\s*\{\s*refresh:\s*true\s*\}\)/);
});

test("a refreshing navigation dispatches the refresh and the push in the same tick", () => {
  const body = functionBody(NAVIGATION_SOURCE, "function navigateWithFeedback(");
  const push = body.slice(body.indexOf("const push = () =>"));
  const refreshAt = push.indexOf("router.refresh()");
  const pushAt = push.indexOf("router.push(href)");

  // Refresh first: it purges the cache as it is dispatched, and the push that follows discards
  // its render, so the page being left (a deleted note) is never re-rendered as not-found.
  assert.ok(refreshAt !== -1 && pushAt !== -1 && refreshAt < pushAt);
  assert.match(push.slice(0, pushAt), /if \(options\?\.refresh\)/);

  // The delayed push away from this page is the one that goes through it.
  assert.match(body, /afterPaint\(\(\) => startRouting\(push\)\)/);
});
