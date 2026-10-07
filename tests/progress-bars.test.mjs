import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/*
 * The onboarding's thick progress bars, app-wide, are on trial: they live in one
 * stylesheet so that taking them back out is deleting one import line. These
 * keep it that way — a rule that moved into redesign.css, or a component that
 * started depending on the file's tokens, would make that line a lie.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function sourceFiles(dir) {
  return readdirSync(new URL(dir, import.meta.url), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(tsx?|css)$/.test(entry.name))
    .map((entry) => `${entry.parentPath ?? entry.path}/${entry.name}`);
}

test("the bars are imported once, after the stylesheets they override", () => {
  const layout = read("../src/app/layout.tsx");
  const imports = [...layout.matchAll(/^import "\.\/([\w-]+\.css)";$/gm)].map((match) => match[1]);

  assert.deepEqual(imports.filter((name) => name === "progress-bars.css"), ["progress-bars.css"]);
  assert.ok(imports.indexOf("progress-bars.css") > imports.indexOf("redesign.css"));
  assert.ok(imports.indexOf("progress-bars.css") > imports.indexOf("onboarding.css"));
});

test("nothing else depends on the file, so removing its import is the whole revert", () => {
  for (const file of sourceFiles("../src/")) {
    if (file.endsWith("progress-bars.css") || file.endsWith("layout.tsx")) {
      continue;
    }

    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /progress-bars\.css/, `${file} refers to progress-bars.css`);
    assert.doesNotMatch(text, /--bar-track|--coral-solid|memo-bar-shimmer/, `${file} uses a token only progress-bars.css declares`);
  }
});

test("the bars are the onboarding's: a 1rem track, a light strip and a sheen", () => {
  const css = read("../src/app/progress-bars.css");

  assert.match(css, /\.memo-progress\.cards,\s*\.memo-progress\.quiz,\s*\.memo-progress\.test,\s*\.memo-panel \.memo-progress\.test \{\s*height: 1rem;/);
  assert.match(css, /\.memo-gen-track,\s*\.memo-tutor-topicbar,\s*\.memo-podcast-progress \{\s*height: 1rem;/);
  assert.match(css, /background: rgba\(255, 255, 255, 0\.38\);/);
  assert.match(css, /animation: memo-bar-shimmer 2\.4s ease-in-out infinite;/);
  // And the dark track is declared in both dark blocks, as every theme token must be.
  assert.equal(css.match(/--bar-track: #262629;/g)?.length, 2);
});
