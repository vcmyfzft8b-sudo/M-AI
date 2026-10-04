import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/*
 * useSheet reads `locked` through a ref that only catches up after a render. So the natural
 * ending of a save, `setBusy(false); sheet.dismiss()`, is ignored: the sheet still sees itself as
 * locked. That left the note's rename sheet open over the old title after every successful
 * rename (found on a preview, Oct 2026). A sheet created with `locked` and closed straight after
 * clearing a busy flag must pass `{ force: true }`.
 */

const componentsDir = new URL("../src/components/", import.meta.url);

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) return sourceFiles(url);
    return /\.(tsx|ts)$/.test(entry.name) ? [url] : [];
  });
}

/** The text of a call's arguments: from just after its `(` to the matching `)`. */
function callArguments(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return source.slice(openIndex + 1);
}

/** Names of sheets created with a `locked` option in this file. */
function lockedSheets(source) {
  const names = new Set();
  for (const match of source.matchAll(/const (\w+) = useSheet\(/g)) {
    // Matched brackets, not the first `);`: the rename sheet's own callback has `);` inside it,
    // and stopping there hid the very sheet this guard was written for.
    const args = callArguments(source, match.index + match[0].length - 1);
    if (/\blocked:/.test(args)) names.add(match[1]);
  }
  return names;
}

/**
 * An unforced `sheet.dismiss(...)` right next to clearing a busy flag, in either order (comments
 * allowed between): `setX(false|null); sheet.dismiss()` and `sheet.dismiss(); setX(false|null)`
 * are the same ignored dismissal, the lock having not caught up yet in both.
 */
function unforcedDismissalsAfterUnlock(source, sheets) {
  const found = [];
  const comments = "(?:\\s*\\/\\/[^\\n]*\\n)*";
  const patterns = [
    new RegExp(`set\\w+\\((?:false|null)\\);\\s*\\n${comments}\\s*(\\w+)\\.dismiss\\(([^\\n]*)\\n`, "g"),
    new RegExp(`(\\w+)\\.dismiss\\(([^\\n]*)\\n${comments}\\s*set\\w+\\((?:false|null)\\);`, "g"),
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (sheets.has(match[1]) && !/force:\s*true/.test(match[2])) {
        found.push(`${match[1]}.dismiss(${match[2].trim()}`);
      }
    }
  }
  return found;
}

test("no locked sheet is closed after its save without forcing past the lock", () => {
  const offenders = [];

  for (const file of sourceFiles(componentsDir)) {
    const source = fs.readFileSync(file, "utf8");
    const sheets = lockedSheets(source);
    if (sheets.size === 0) continue;
    for (const call of unforcedDismissalsAfterUnlock(source, sheets)) {
      offenders.push(`${path.basename(file.pathname)}: ${call}`);
    }
  }

  assert.deepEqual(offenders, []);
});

test("the guard recognises the pattern it exists for", () => {
  const broken = [
    "const renameSheet = useSheet(",
    "  useCallback(() => {",
    "    setRenameOpen(false);",
    "  }, []),",
    "  { locked: isBusy },",
    ");",
    "async function save() {",
    "  setIsBusy(false);",
    "  renameSheet.dismiss(() => refresh());",
    "}",
    "",
  ].join("\n");
  const fixed = broken.replace("renameSheet.dismiss(() => refresh());", "renameSheet.dismiss(() => refresh(), { force: true });");

  assert.deepEqual(unforcedDismissalsAfterUnlock(broken, lockedSheets(broken)), ["renameSheet.dismiss(() => refresh());"]);
  assert.deepEqual(unforcedDismissalsAfterUnlock(fixed, lockedSheets(fixed)), []);

  // The other order is the same ignored dismissal.
  const reversed = broken.replace("  setIsBusy(false);\n  renameSheet.dismiss(() => refresh());", "  renameSheet.dismiss(() => refresh());\n  setIsBusy(false);");
  assert.notEqual(reversed, broken);
  assert.deepEqual(unforcedDismissalsAfterUnlock(reversed, lockedSheets(reversed)), ["renameSheet.dismiss(() => refresh());"]);
});

test("dismiss only lets a forced close past the lock", () => {
  const hook = fs.readFileSync(new URL("use-sheet.ts", componentsDir), "utf8");

  assert.match(hook, /if \(lockedRef\.current && !options\?\.force\) \{\s*return;/);
});
