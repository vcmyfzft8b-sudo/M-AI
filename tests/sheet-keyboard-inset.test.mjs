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

/** Any `max-height` declared in a rule body. */
function maxHeights(body) {
  return [...body.matchAll(/max-height:([^;]*);/g)].map((m) => m[1].trim());
}

/**
 * 12pt, measured off iOS's own composer: on a 393pt screen the message box's
 * bottom edge lands 36 device pixels above the keyboard. Every sheet used to
 * keep its own resting padding there instead, so the gap you typed into
 * depended on which sheet you had opened.
 */
test("every sheet leaves the same gap between a focused field and the keys", () => {
  assert.match(
    css,
    /--memo-kb-clear:\s*0\.75rem/,
    "the measured clearance is the number every sheet is supposed to use",
  );
  assert.match(
    css,
    /--memo-kb-foot:\s*calc\(var\(--memo-kb\) \+ var\(--memo-kb-clear\)\)/,
    "a sheet's keys-up foot is the keyboard plus that clearance, nothing else",
  );

  for (const sheet of SHEETS) {
    const feet = rulesFor(sheet)
      // `(?<![-\w])` so `scroll-padding` is not mistaken for the foot itself.
      .flatMap((rule) => [...rule.body.matchAll(/(?<![-\w])padding(?:-bottom)?:([^;]*);/g)])
      .map((m) => m[1])
      .filter((value) => /--memo-kb\b|--memo-kb-foot|--memo-kb-clear/.test(value));

    assert.ok(feet.length > 0, `.${sheet} never pads its foot for the keys`);

    for (const foot of feet) {
      const value = foot.trim();

      // A bare `var(--memo-kb)` is a container reserving room for the keys; the
      // foot inside it is what supplies the gap. That one is fine as it stands.
      if (/^var\(--memo-kb\)$/.test(value)) {
        continue;
      }

      /*
       * `calc(<rest> + var(--memo-kb))` is the shape that went wrong: a sheet's
       * resting padding stacked on top of the whole keyboard inset, so the gap
       * came out as that padding rather than the measured clearance. Every
       * honest shape names the clearance.
       */
      assert.ok(
        /--memo-kb-foot|--memo-kb-clear/.test(value),
        `.${sheet} sets its own gap instead of using the shared clearance: ${value}`,
      );
    }
  }
});

test("no phone sheet is capped against a viewport that ignores the keyboard", () => {
  for (const sheet of SHEETS) {
    const caps = rulesFor(sheet).flatMap((rule) => maxHeights(rule.body));

    for (const cap of caps) {
      /*
       * `dvh` answers for browser chrome, not for the keys, and mobile Safari
       * never shrinks the layout viewport `%` resolves against — so a sheet
       * measured in either was allowed to be taller than the screen you can
       * see, and hung its header off the top. The measured viewport is the
       * only honest answer.
       */
      assert.ok(
        !/dvh/.test(cap),
        `.${sheet} is capped in dvh (${cap}), which does not shrink with the keyboard`,
      );
    }

    if (caps.length > 0) {
      assert.ok(
        caps.some((cap) => /--memo-sheet-max|--memo-vv\b/.test(cap)),
        `.${sheet} is capped without the measured viewport: ${caps.join(" | ")}`,
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
  assert.match(
    inset,
    /--memo-viewport/,
    "the visible viewport has to be published: no CSS unit reports it",
  );
  assert.match(
    inset,
    /--memo-viewport-top/,
    "so does the pan offset, or Safari draws fixed sheets above the screen",
  );
  assert.match(css, /--memo-vv:\s*var\(--memo-viewport, 100dvh\)/);
  assert.match(css, /--memo-sheet-max:\s*calc\(var\(--memo-vv\) \+ var\(--memo-kb\) - 54px\)/);
});
