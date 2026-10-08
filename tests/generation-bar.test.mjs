import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/*
 * The bar under "Ustvarjam zapiske" is the only sign a note is still being made, so it
 * has to be seen moving. Two things stopped it: Reduce Motion swapped the sweep for a
 * still bar, and the sweep itself rested off-screen for half of every pass.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const redesign = read("../src/app/redesign.css");

test("the sweep is declared once, so no later stylesheet replaces it", () => {
  const files = readdirSync(new URL("../src/app/", import.meta.url), { recursive: true })
    .filter((name) => name.endsWith(".css"));
  const declarations = files.flatMap((name) =>
    (read(`../src/app/${name}`).match(/@keyframes memo-gen-sweep\b/g) ?? []).map(() => name),
  );

  assert.deepEqual(declarations, ["redesign.css"]);
});

test("the sweep runs edge to edge with no rest, so the track is never left empty", () => {
  const keyframes = redesign.match(/@keyframes memo-gen-sweep \{([\s\S]*?)\n\}/)?.[1];

  assert.ok(keyframes, "memo-gen-sweep is missing");
  assert.match(keyframes, /from \{\s*transform: translateX\(-100%\);/);
  // The fill is 38% of the track: 100 / 38 = 263%.
  assert.match(redesign, /\.memo-gen-track > span \{[^}]*width: 38%;/);
  assert.match(keyframes, /to \{\s*transform: translateX\(263\.2%\);/);
  assert.doesNotMatch(keyframes, /\d+%,\s*\d+%/, "a held keyframe parks the bar off-screen");
});

test("Reduce Motion slows the sweep instead of stopping it", () => {
  const blocks = [...redesign.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
    .map((match) => match[1])
    .filter((block) => block.includes(".memo-gen-track > span"));

  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /animation-iteration-count: infinite !important;/);
  assert.match(blocks[0], /animation-duration: [\d.]+s !important;/);
  assert.doesNotMatch(blocks[0], /animation: none|transform: none/);
});
