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

/** Names of sheets created with a `locked` option in this file. */
function lockedSheets(source) {
  const names = new Set();
  for (const match of source.matchAll(/const (\w+) = useSheet\(/g)) {
    // The call's arguments: up to the first `);` at the call's own indentation or end of line.
    const rest = source.slice(match.index + match[0].length);
    const end = rest.search(/\n\s*\);|\);\n/);
    if (/\blocked:/.test(rest.slice(0, end === -1 ? 400 : end))) names.add(match[1]);
  }
  return names;
}

/** `setX(false|null);` followed (comments allowed) by `sheet.dismiss(...)` without force. */
function unforcedDismissalsAfterUnlock(source, sheets) {
  const found = [];
  const pattern = /set\w+\((?:false|null)\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*(\w+)\.dismiss\(([^\n]*)\n/g;
  for (const match of source.matchAll(pattern)) {
    if (sheets.has(match[1]) && !/force:\s*true/.test(match[2])) {
      found.push(`${match[1]}.dismiss(${match[2].trim()}`);
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
    "  onClosed,",
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
});

test("dismiss only lets a forced close past the lock", () => {
  const hook = fs.readFileSync(new URL("use-sheet.ts", componentsDir), "utf8");

  assert.match(hook, /if \(lockedRef\.current && !options\?\.force\) \{\s*return;/);
});
