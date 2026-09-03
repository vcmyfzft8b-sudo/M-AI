import assert from "node:assert/strict";
import test from "node:test";

import {
  pillNeighbourhoodScrollTarget,
  tabScrollTarget,
  TAB_SCROLL_GUTTER_PX,
} from "../src/lib/tab-scroll.ts";

/**
 * Tapping a pill in the note screen's tab row.
 *
 * The row below is the phone's: five pills that do not fit, sized roughly as
 * the real ones are. Every case is stated as "the row is here, this pill is
 * tapped" so the expectations read as positions rather than as arithmetic.
 */

const PILL_WIDTHS = [110, 150, 100, 96, 140];
const GAP = 10;
const VIEWPORT = 390;

/** Pill lefts, laid out end to end the way the flex row lays them out. */
const PILL_LEFTS = PILL_WIDTHS.reduce(
  (lefts, width, index) => [...lefts, lefts[index] + width + GAP],
  [0],
).slice(0, PILL_WIDTHS.length);

const CONTENT = PILL_LEFTS[PILL_WIDTHS.length - 1] + PILL_WIDTHS[PILL_WIDTHS.length - 1];

/** The row at `scrollLeft`, with pill `index` tapped. */
function tap(index, scrollLeft, overrides = {}) {
  return tabScrollTarget({
    scrollLeft,
    viewportWidth: VIEWPORT,
    contentWidth: CONTENT,
    pillLeft: PILL_LEFTS[index],
    pillWidth: PILL_WIDTHS[index],
    ...overrides,
  });
}

test("a pill already well inside the row does not move it", () => {
  assert.equal(tap(0, 0), null);
  assert.equal(tap(1, 0), null);
});

test("the half-cut pill at the trailing edge is pulled in whole, plus the gutter", () => {
  /* Pill 2 ends at 380 of a 390 viewport: visible, but under the fade. */
  const target = tap(2, 0);
  assert.equal(target, PILL_LEFTS[2] + PILL_WIDTHS[2] + TAB_SCROLL_GUTTER_PX - VIEWPORT);
  /* And once there, it is whole with room to spare beyond it. */
  assert.ok(PILL_LEFTS[2] >= target);
  assert.ok(PILL_LEFTS[2] + PILL_WIDTHS[2] + TAB_SCROLL_GUTTER_PX <= target + VIEWPORT);
});

test("a pill off the leading edge scrolls back to it", () => {
  const target = tap(0, 300);
  assert.equal(target, 0);
});

test("a pill cut by the leading edge keeps the gutter in front of it", () => {
  const target = tap(1, PILL_LEFTS[1] + 20);
  assert.equal(target, PILL_LEFTS[1] - TAB_SCROLL_GUTTER_PX);
});

test("the last pill stops at the end of the row rather than past it", () => {
  const last = PILL_WIDTHS.length - 1;
  const target = tap(last, 0);
  assert.equal(target, CONTENT - VIEWPORT);
  /* The gutter would have asked for more; the clamp is what refuses. */
  assert.ok(PILL_LEFTS[last] + PILL_WIDTHS[last] + TAB_SCROLL_GUTTER_PX - VIEWPORT > target);
});

test("the first pill stops at the start of the row rather than before it", () => {
  assert.equal(tap(0, 5), 0);
});

test("a row that fits its pills never scrolls", () => {
  assert.equal(tap(4, 0, { viewportWidth: CONTENT, contentWidth: CONTENT }), null);
  assert.equal(tap(4, 0, { viewportWidth: CONTENT + 100, contentWidth: CONTENT }), null);
});

test("a pill wider than the room it has shows its start", () => {
  /* No gutter fits on both sides, so the clamp splits what is left. */
  const target = tabScrollTarget({
    scrollLeft: 0,
    viewportWidth: 200,
    contentWidth: 800,
    pillLeft: 300,
    pillWidth: 190,
  });
  assert.equal(target, 300 - 5);
});

test("a pill exactly as wide as the row lands flush against its start", () => {
  const target = tabScrollTarget({
    scrollLeft: 0,
    viewportWidth: 200,
    contentWidth: 800,
    pillLeft: 300,
    pillWidth: 200,
  });
  assert.equal(target, 300);
});

test("sub-pixel differences are left alone", () => {
  /* Chasing these would fight the scroller's own rounding for no visible gain. */
  assert.equal(tap(1, PILL_LEFTS[1] - TAB_SCROLL_GUTTER_PX + 0.4), null);
});

test("every pill in the row ends up whole and inside it, from every offset", () => {
  const maxScroll = CONTENT - VIEWPORT;
  for (let index = 0; index < PILL_WIDTHS.length; index += 1) {
    for (let scrollLeft = 0; scrollLeft <= maxScroll; scrollLeft += 7) {
      const target = tap(index, scrollLeft) ?? scrollLeft;
      assert.ok(target >= 0 && target <= maxScroll, `offset ${target} is off the row`);
      assert.ok(PILL_LEFTS[index] >= target - 1, `pill ${index} is cut at the start`);
      assert.ok(
        PILL_LEFTS[index] + PILL_WIDTHS[index] <= target + VIEWPORT + 1,
        `pill ${index} is cut at the end`,
      );
    }
  }
});

test("selecting a pill brings the next one fully into view", () => {
  // A row 300 wide scrolled to 0. The chosen pill ends at 290 and the next runs 300..420,
  // so showing only the chosen one leaves the obvious next choice unreadable.
  const target = pillNeighbourhoodScrollTarget({
    row: { scrollLeft: 0, clientWidth: 300, scrollWidth: 600, left: 0 },
    pill: { left: 170, width: 120 },
    previous: null,
    next: { left: 300, width: 120 },
  });

  assert.ok(target !== null && target >= 120, `expected the next pill shown, got ${target}`);
});

test("the pill before comes along when the whole neighbourhood fits", () => {
  /*
   * The chosen pill is flush against the left edge with the previous one just off it.
   * Pill rects are viewport coordinates, so a pill to the left of the row's own left
   * edge has a negative `left`; the neighbourhood spans content 430..650, which fits a
   * 400-wide row, so the row should scroll back far enough to uncover the previous pill.
   */
  const target = pillNeighbourhoodScrollTarget({
    row: { scrollLeft: 500, clientWidth: 400, scrollWidth: 900, left: 0 },
    previous: { left: -70, width: 60 },
    pill: { left: 0, width: 80 },
    next: { left: 90, width: 60 },
  });

  assert.ok(target !== null && target <= 430, `expected room made to the left, got ${target}`);
});

test("the pill before is given up rather than pushing the chosen one out of view", () => {
  // The chosen pill and its next already fill the row; taking the previous one along
  // would need 320 of a 200-wide row, so it is dropped.
  const target = pillNeighbourhoodScrollTarget({
    row: { scrollLeft: 0, clientWidth: 200, scrollWidth: 900, left: 0 },
    previous: { left: 300, width: 120 },
    pill: { left: 430, width: 120 },
    next: { left: 560, width: 60 },
  });

  assert.ok(target !== null && target >= 420, `the chosen pill must stay visible, got ${target}`);
});

test("a row that does not overflow never moves", () => {
  assert.equal(
    pillNeighbourhoodScrollTarget({
      row: { scrollLeft: 0, clientWidth: 600, scrollWidth: 600, left: 0 },
      previous: null,
      pill: { left: 0, width: 100 },
      next: { left: 110, width: 100 },
    }),
    null,
  );
});
