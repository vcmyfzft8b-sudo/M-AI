import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHAT_SLOT_REM,
  TIGHT_SAVINGS_REM,
  annotateDockFit,
} from "../src/lib/annotate-dock-fit.ts";

/*
 * The annotation dock has to show every one of its buttons on every phone.
 *
 * Widths below are the real row, measured in headless Chrome on the demo note
 * (Oct 2026): the highlight button's icon part and four icon buttons, with the
 * row's padding, come to 218px; the English label adds 70px and its 0.4rem gap.
 * The dock's line is the viewport less 37px of margin, and the room beside the
 * chat button is that line less 4.1rem.
 */
const ICONS = 218;
const LABEL = 70 + 6.4;
const room = (viewport) => viewport - 37 - CHAT_SLOT_REM * 16;

test("a phone with room for the label shows it", () => {
  for (const viewport of [400, 414, 430]) {
    assert.equal(annotateDockFit({ icons: ICONS, label: LABEL, room: room(viewport) }), "full", `${viewport}px`);
  }
});

test("the phones that used to cut the photo button off fold the label instead", () => {
  // 360px to ~397px: the old 359px breakpoint left the label up here, and the row overflowed.
  // 320px folds it too, as the old breakpoint did.
  for (const viewport of [320, 360, 375, 390, 393]) {
    assert.equal(annotateDockFit({ icons: ICONS, label: LABEL, room: room(viewport) }), "compact", `${viewport}px`);
  }
});

test("narrower still — a split screen, a zoomed page — the buttons close up as well", () => {
  assert.equal(annotateDockFit({ icons: ICONS, label: LABEL, room: room(300) }), "tight");
  // And tight is enough there: what it saves brings the row inside the room.
  assert.ok(ICONS - TIGHT_SAVINGS_REM * 16 <= room(300));
});

test("desktop has no cap and always shows the label", () => {
  assert.equal(annotateDockFit({ icons: ICONS, label: LABEL, room: Number.POSITIVE_INFINITY }), "full");
});

test("a longer label in another language folds sooner, by its own width", () => {
  assert.equal(annotateDockFit({ icons: ICONS, label: 120, room: room(430) }), "compact");
});

test("the numbers the decision uses are the ones the stylesheet draws", () => {
  const css = readFileSync(new URL("../src/app/redesign.css", import.meta.url), "utf8");

  // The chat button's slot.
  assert.match(css, new RegExp(`max-width: calc\\(100% - ${CHAT_SLOT_REM}rem\\)`));

  // What tight takes off: icons 2.3 -> 2.05, colour 2.5 -> 2.2, padding 0.7 -> 0.5 a side.
  assert.match(css, /\[data-fit="tight"\] \.memo-annotate-icon \{\s*width: 2\.05rem;/);
  assert.match(css, /\[data-fit="tight"\] \.memo-palette-trigger \{\s*width: 2\.2rem;/);
  assert.match(css, /\[data-fit="tight"\] \.memo-annotate-primary \{\s*padding: 0 0\.5rem;/);
  assert.match(css, /\.memo-annotate-icon \{[^}]*width: 2\.3rem;/);
  assert.match(css, /\.memo-palette-trigger \{[^}]*width: 2\.5rem;/);
  assert.match(css, /\.memo-annotate-primary \{[^}]*padding: 0 0\.7rem;/);
  assert.equal(TIGHT_SAVINGS_REM.toFixed(2), (3 * (2.3 - 2.05) + (2.5 - 2.2) + 2 * (0.7 - 0.5)).toFixed(2));

  // And the old breakpoint is gone, so the two cannot disagree.
  assert.doesNotMatch(css, /@media \(max-width: 359px\) \{\s*\.memo-dock-pill\.annotating/);
});
