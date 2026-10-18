import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * The exam screens' bottom bar puts its buttons where the home screen puts its chat and "New"
 * buttons, on the web and in the app, so the main action never jumps between screens.
 */
const css = readFileSync(new URL("../src/app/redesign.css", import.meta.url), "utf8");
// Comments out and whitespace collapsed, so a rule reads as one line.
const squash = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");

function foot(selector) {
  const block = squash(css).match(new RegExp(`[{}] ${selector} \\{ --memo-exam-bar-foot: (calc\\(.*?\\) \\));`));
  assert.ok(block, `${selector} sets the bar's foot`);
  return block[1];
}

test("on the web the bar stands at the home bar's height, keyboard lift included", () => {
  assert.match(squash(css), /\.memo-m-homebar \{ position: absolute; inset: auto 1\.15rem calc\( var\(--memo-kb-down\) \* \(1\.9rem \+ var\(--memo-safe-bottom\)\) \+ var\(--memo-kb-up\) \* var\(--memo-kb-clear\) \)/);
  assert.equal(foot("\\.memo-exam-screen"), "calc( var(--memo-kb-down) * (1.9rem + var(--memo-safe-bottom)) + var(--memo-kb-up) * var(--memo-kb-clear) )");
});

test("in the app it follows the home dock down onto the home indicator", () => {
  assert.match(squash(css), /html\[data-native\] \.memo-m-homebar, html\[data-native\] \.memo-dock, html\[data-native\] \.memo-sub-chatbar \{[^}]*calc\( var\(--memo-kb-down\) \* \(0\.15rem \+ var\(--memo-safe-bottom\)\)/);
  assert.equal(foot("html\\[data-native\\] \\.memo-exam-screen"), "calc( var(--memo-kb-down) * (0.15rem + var(--memo-safe-bottom)) + var(--memo-kb-up) * var(--memo-kb-clear) )");
});

test("the bar and the room kept for it both use that one foot", () => {
  assert.match(squash(css), /\.memo-exam-cta \{ position: absolute;[^}]*padding: 1\.6rem 1\.15rem var\(--memo-exam-bar-foot\);/);
  assert.match(squash(css), /\.memo-exam-page \{ padding-bottom: calc\(5rem \+ var\(--memo-exam-bar-foot\)\); \}/);
});
