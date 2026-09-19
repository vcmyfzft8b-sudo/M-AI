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

test("every phone sheet keeps its content clear of the keys", () => {
  for (const sheet of SHEETS) {
    const clears = rulesFor(sheet).some((rule) =>
      /(?:padding|border-bottom)[^;]*--memo-kb\b/.test(rule.body),
    );

    assert.ok(clears, `.${sheet} never answers for the keys, so they cover it`);
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
    /--memo-kb-ground:\s*calc\(var\(--memo-kb\) \+ var\(--memo-kb-bar\)\)/,
    "the strip behind the keys is the inset plus anything visualViewport misses",
  );
  assert.match(
    css,
    /--memo-kb-bar:\s*0px/,
    "no platform gets an accessory bar reserved unless it actually draws one",
  );
  assert.match(
    css,
    /-webkit-touch-callout: none[\s\S]{0,400}--memo-kb-bar:\s*calc\(var\(--memo-keyboard-bar, 0\)/,
    "iOS on the web is the only place the accessory bar is reserved",
  );
  /*
   * And only when it is actually covering something. With the software keyboard
   * up `visualViewport` stops above the bar, so a sheet on the bottom edge
   * already ends on the keyboard's top edge — and because the ground is a
   * border, and a scrollport ends where its border begins, a reserve there took
   * 55px out of the scrollport and cut the focused field in half. Measured on
   * an iPhone 17 in Safari: field at 321..378, scrollport ending at 349.
   */
  assert.doesNotMatch(
    css,
    /--memo-kb-bar:\s*calc\(var\(--memo-kb-up\)/,
    "reserving the bar for every focus is what sliced the field in half in Safari",
  );
  assert.match(
    css,
    /--memo-kb-up:\s*var\(--memo-keyboard-up, 0\)/,
    "the clearance follows the measured keyboard, not `:focus` stepping on and off",
  );
  assert.doesNotMatch(
    css,
    /:has\([^)]*:focus\)[\s\S]{0,120}--memo-kb-up/,
    "reading focus directly is what made the clearance vanish mid-dismissal",
  );

  for (const sheet of SHEETS) {
    const feet = rulesFor(sheet)
      // `(?<![-\w])` so `scroll-padding` is not mistaken for the foot itself.
      .flatMap((rule) => [
        ...rule.body.matchAll(/(?<![-\w])(?:padding(?:-bottom)?|border-bottom):([^;]*);/g),
      ])
      .map((m) => m[1])
      .filter((value) => /--memo-kb\b|--memo-kb-clear/.test(value));

    assert.ok(feet.length > 0, `.${sheet} never pads its foot for the keys`);

    for (const foot of feet) {
      const value = foot.trim();

      /*
       * The ground behind the keys is a reserve, not a gap — it is what the
       * keyboard overlaps, and the foot inside it supplies the clearance. A
       * bare `var(--memo-kb)` reads the same way on a container.
       */
      if (/^var\(--memo-kb(?:-ground)?\)(?: solid .+)?$/.test(value)) {
        continue;
      }

      /*
       * `calc(<rest> + var(--memo-kb))` is the shape that went wrong: a sheet's
       * resting padding stacked on top of the whole keyboard inset, so the gap
       * came out as that padding rather than the measured clearance. Every
       * honest shape names the clearance.
       */
      assert.ok(
        /--memo-kb-clear/.test(value),
        `.${sheet} sets its own gap instead of using the shared clearance: ${value}`,
      );
    }
  }
});

/*
 * The ground is a border, and a scrollport ends where its border begins — so
 * the scrollport's own bottom edge is already the top of the keyboard. Scroll
 * padding that adds the keyboard again counts it twice, and the scroller drags
 * the focused field a whole keyboard further up than it needs to: measured on
 * the flashcard editor, 101px of scroll delivered after the keyboard had
 * already finished, as a jump of its own.
 */
test("scrolling a field into view does not subtract the keyboard twice", () => {
  assert.match(
    css,
    /--memo-kb-scroll:\s*var\(--memo-kb-clear\)/,
    "a field the sheet scrolls to should land at the clearance, like every foot",
  );
  assert.doesNotMatch(
    css,
    /--memo-kb-scroll:[^;]*--memo-kb-ground/,
    "the scrollport already stops at the keys; adding them again over-scrolls",
  );
});

/*
 * The clearance is a floor, not a mark to hit. A field further than 12pt above
 * the keys is where the person left it; only one the keys would come within
 * 12pt of is moved, and only far enough. Forcing every field down to the
 * clearance was tried on the flashcard editor and takes the sheet's header and
 * its whole card list under the keyboard with it.
 */
test("a focused field is lifted clear of the keys and never pulled down to them", () => {
  const inset = readFileSync(
    fileURLToPath(new URL("../src/components/keyboard-inset.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(
    inset,
    /Math\.max\(liftFrom, reachable\)/,
    "the scroll may only grow: shrinking it drags the field towards the keyboard",
  );
  assert.match(
    inset,
    /lift\(eased\)/,
    "and it rides the keyboard's own curve rather than landing after it",
  );
});

/*
 * The stage a flashcard stands in is `flex: 1` under a cap, so on a short
 * screen it is handed less than the card's floor — and a card that insists on
 * its floor does not shrink, it overflows, straight over the answer row
 * underneath. Measured in Safari, where the browser's chrome costs 160px of
 * screen: a 272px stage with a 320px card in it, the card's bottom edge at 584
 * and the review buttons starting at 572. The wrapper never showed it, because
 * 874px of screen leaves the stage its full 352.
 */
test("a flashcard cannot be taller than the stage it stands in", () => {
  assert.match(
    css,
    /lecture-flashcard-face \{\s*min-height: min\(20rem, 100%\)/,
    "the card's floor has to yield to the room the stage actually has",
  );
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
  /*
   * Read off a box pinned to the bottom edge rather than rebuilt from window
   * metrics. `innerHeight - height - offsetTop` tears: WebKit updates the three
   * on different frames, and a fresh value minus two stale ones is a whole
   * keyboard that is not there — 310px of ground on one frame and 0 on the
   * next, measured in Safari on an iPhone 17.
   */
  assert.match(
    inset,
    /position:fixed[^"]*bottom:0/,
    "the inset is measured against a foot pinned to the bottom of the page",
  );
  assert.doesNotMatch(
    inset,
    /window\.innerHeight - viewport\.height/,
    "the window-metric subtraction tears across frames; that is why it went",
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
  assert.match(
    inset,
    /--memo-keyboard-up/,
    "and whether the keys are up, which `:focus` answers too early on dismissal",
  );

  /*
   * The dismissal is the one movement the page has to draw itself: raising the
   * keyboard arrives as a stream of viewport updates and is tracked, but
   * putting it away arrives as a single update delivered after the animation
   * has finished. Sample-only, the sheet sits still for a quarter of a second
   * and then drops in one frame. Deleting this as "an imitation curve" puts
   * that jump straight back.
   */
  assert.match(
    inset,
    /KEYBOARD_MS\s*=\s*250/,
    "the dismissal is drawn over UIKit's own duration",
  );
  assert.match(
    inset,
    /KEYBOARD_CURVE\s*=\s*\[0\.38, 0\.7, 0\.125, 1\]/,
    "and on UIKit's own curve, or it will not read as the keyboard's movement",
  );
  assert.match(
    inset,
    /requestAnimationFrame/,
    "stepped per frame rather than handed to a CSS transition on padding",
  );
  /*
   * The clearance is ramped on that same curve, in both directions and on every
   * platform. Stepped, it swaps a resting foot for a 12pt one in a single
   * frame — which is a hop of the difference between them, and on mobile
   * Safari, where the inset is 0 the whole time the keys are up, it is the only
   * thing that moves at all.
   */
  assert.match(
    inset,
    /const rampUp = \(to: number\)/,
    "the clearance ramps rather than stepping",
  );
  assert.match(
    inset,
    /const eased = ease\(t\);[\s\S]{0,120}upFrom \+ \(upTo - upFrom\) \* eased/,
    "and it ramps on the keyboard's curve, not linearly",
  );
  /*
   * And it sets off with the ground, never ahead of it. iOS reports the first
   * viewport change 124ms after `focusin`; a clearance ramping through that
   * window tightens the foot by 54pt against a ground that is still flat, and
   * the sheet drops that far before it rises.
   */
  assert.match(
    inset,
    /const syncClearance[\s\S]{0,600}published > 0 \|\| viewport\.offsetTop > 0/,
    "the clearance waits for the ground, or for a browser that will never have one",
  );
  /*
   * Which of those it is gets asked per keyboard. Mobile Safari picks per
   * interaction — the same session panned the visual viewport for one sheet and
   * left the page behind the keys for the next — and remembering the answer put
   * the rename sheet underneath the keyboard for the rest of the page's life.
   */
  assert.doesNotMatch(
    inset,
    /let pans\b/,
    "the regime is a question about this moment, not a flag about this page",
  );
  /*
   * A sheet's cap is `viewport + inset`, and that sum is invariant — the
   * keyboard takes exactly as much off the visible viewport as it adds to the
   * strip behind it. The browser reports the shrunken viewport in one frame
   * while the inset is drawn over a quarter of a second, so publishing the
   * viewport raw made the cap collapse by a whole keyboard and spring back.
   * Sheets short enough never to be capped never showed it; the flashcard
   * editor dropped 308px and bounced, measured on an iPhone 17.
   */
  assert.match(
    inset,
    /fullHeight - inset/,
    "the published viewport moves in step with the drawn inset, not ahead of it",
  );
  assert.match(css, /--memo-vv:\s*var\(--memo-viewport, 100dvh\)/);
  assert.match(css, /--memo-sheet-max:\s*calc\(var\(--memo-vv\) \+ var\(--memo-kb\) - 54px\)/);
});
