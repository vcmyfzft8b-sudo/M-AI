import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Where a bottom sheet meets the soft keyboard.
 *
 * The rule the phone layer keeps is that the keyboard is read in exactly one
 * place per sheet — its foot padding — and never as a bottom offset. Two
 * separate failures come from breaking it, and neither shows up anywhere but a
 * real phone with the keys up:
 *
 *  - Several of these sheets sit inside a wrapper that paints a
 *    `backdrop-filter`, which makes the wrapper the containing block for the
 *    fixed sheet inside it. A wrapper that ends above the keys *and* a sheet
 *    that ends above the keys subtract the inset twice, and the sheet comes to
 *    rest a whole keyboard's height above the keyboard with its header off the
 *    top of the screen. That is what "Nova mapa" did.
 *
 *  - A sheet that ends on top of the keys draws its own bottom edge across the
 *    middle of the screen with the page showing through beside it, which reads
 *    as a sheet cut in half rather than one the keyboard has slid over.
 *
 * Both are one declaration away at all times, so they are asserted rather than
 * left to the next person to find on a phone.
 */

const css = readFileSync(
  fileURLToPath(new URL("../src/app/redesign.css", import.meta.url)),
  "utf8",
);

/** Every rule in the stylesheet as `{ selector, body }`, media queries flattened. */
function rules() {
  const found = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    found.push({ selector: match[1].trim(), body: match[2] });
  }
  return found;
}

const ALL_RULES = rules();

/** The phone layer's bottom sheets, by the class each one is drawn as. */
const SHEETS = [
  "memo-sheet",
  "memo-sheet-full",
  "memo-action-sheet",
  "memo-dialog",
  "memo-confirm-fixed",
  "memo-quiz-sheet",
  "library-folder-mobile-sheet",
  "library-folder-modal",
  "note-source-modal",
  "study-manager-sheet",
  "note-read-usage-mobile-sheet",
  "memo-palace-panel",
  "memo-palace-sheet-inner",
];

/** The scrims and wrappers these sheets are portalled inside. */
const WRAPPERS = [
  "library-folder-modal-overlay",
  "note-source-modal-wrap",
  "ios-sheet-wrap",
  "study-manager-backdrop",
  "memo-scrim",
  "memo-palace-sheet",
];

function rulesFor(className) {
  const token = new RegExp(`\\.${className}(?![\\w-])`);
  return ALL_RULES.filter((rule) => token.test(rule.selector));
}

/** `bottom: var(--memo-kb)`, or an `inset` shorthand whose bottom is the inset. */
function positionsItsBottomFromTheKeyboard(body) {
  // `(?<![-\w])` so `padding-bottom` is not mistaken for the edge itself, and
  // `(?![\w-])` so the padding token `--memo-kb-pad` is not mistaken for it either.
  if (/(?<![-\w])bottom:[^;]*--memo-kb(?![\w-])/.test(body)) {
    return true;
  }

  for (const inset of body.matchAll(/\binset:([^;]*);/g)) {
    // `inset: auto 0 X 0` and `inset: T 0 X 0` alike — the third value is the
    // bottom edge, and `--memo-kb` has no business being it.
    const parts = inset[1].trim().split(/\s+(?![^(]*\))/);
    if (parts.length >= 3 && /--memo-kb(?![\w-])/.test(parts[2])) {
      return true;
    }
  }

  return false;
}

test("no phone sheet takes the keyboard out of its bottom edge", () => {
  for (const sheet of SHEETS) {
    const matches = rulesFor(sheet);
    assert.ok(matches.length > 0, `no rule found for .${sheet} — was it renamed?`);

    for (const rule of matches) {
      assert.equal(
        positionsItsBottomFromTheKeyboard(rule.body),
        false,
        `.${sheet} ends above the keys instead of padding past them: ${rule.selector}`,
      );
    }
  }
});

test("every phone sheet pads its foot clear of the keys", () => {
  for (const sheet of SHEETS) {
    const pads = rulesFor(sheet).some((rule) =>
      /padding[^;]*--memo-kb\b/.test(rule.body),
    );

    assert.ok(pads, `.${sheet} never pads its foot by --memo-kb, so the keys cover it`);
  }
});

test("scrims and sheet wrappers stay the full viewport", () => {
  for (const wrapper of WRAPPERS) {
    for (const rule of rulesFor(wrapper)) {
      assert.equal(
        positionsItsBottomFromTheKeyboard(rule.body),
        false,
        `.${wrapper} ends above the keys, which subtracts the inset twice for the ` +
          `fixed sheet inside it: ${rule.selector}`,
      );
    }
  }
});

test("the keyboard's own measurement is still published for them to read", () => {
  const inset = readFileSync(
    fileURLToPath(new URL("../src/components/keyboard-inset.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(inset, /--memo-keyboard/, "nothing publishes the measured inset");
  assert.match(
    inset,
    /viewport\.offsetTop/,
    "the measurement has to answer for WebKit panning the visual viewport",
  );
  assert.match(css, /--memo-kb:\s*var\(--memo-keyboard, 0px\)/);
  assert.match(css, /--memo-kb-pad:\s*max\(var\(--memo-safe-bottom\), var\(--memo-kb\)\)/);
});
