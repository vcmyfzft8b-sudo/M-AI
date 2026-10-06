import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

/*
 * A Home Screen web app (iOS `navigator.standalone`, mirrored as `data-standalone`) answers the
 * keyboard differently from Safari, measured on an iPhone 17 Pro in Oct 2026:
 * - its visible strip always ends at the top of the form bar (∧ ∨ ✓), so reserving the bar again
 *   left a 55pt gap under every sheet;
 * - when it pans, fixed boxes stay put on screen, so subtracting `offsetTop` anchored the fix-word
 *   sheet's buttons 178pt down, under the keys.
 */

const source = fs.readFileSync(new URL("../src/components/keyboard-inset.tsx", import.meta.url), "utf8");

test("the installed web app never reserves Safari's form bar", () => {
  assert.match(
    source,
    /const barValue = \(\) => \{[\s\S]*?if \(root\.hasAttribute\("data-native"\) \|\| root\.hasAttribute\("data-standalone"\)\) \{\s*return 0;/,
  );
});

test("the installed web app ignores the pan when placing fixed boxes", () => {
  assert.match(source, /const panned = \(\) =>\s*root\.hasAttribute\("data-standalone"\) \? 0 : viewport\.offsetTop;/);
  assert.match(source, /line - \(panned\(\) \+ viewport\.height\)/);
  assert.match(source, /Math\.round\(panned\(\)\)/);
  // Nothing else measures the pan for positioning behind the helper's back.
  assert.doesNotMatch(source, /line - \(viewport\.offsetTop/);
});

test("the standalone flag the rules rely on is set before the app hydrates", () => {
  const layout = fs.readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /window\.navigator\.standalone === true[\s\S]{0,120}dataset\.standalone = ""/);
});
