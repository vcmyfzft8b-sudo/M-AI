import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("a visited link never outranks the class that colours it", () => {
  const globals = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  // `a:visited` is (0,1,1) and beat `.memo-tutor-start` (0,1,0): the tutor's
  // "See plans" link went white on its white button after Settings was visited.
  assert.doesNotMatch(globals, /^a:visited\s*\{/m);
  assert.match(globals, /^:where\(a:visited\) \{\s*color: inherit;/m);
  const css = ["globals.css", "redesign.css", "onboarding.css"]
    .map(name => readFileSync(new URL(`../src/app/${name}`, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(css.replace(/:where\([^)]*\)/g, ""), /(^|[\s,}])a:visited\b/);
});
