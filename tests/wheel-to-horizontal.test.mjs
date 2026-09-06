import assert from "node:assert/strict";
import test from "node:test";

import { wheelToHorizontalScroll } from "../src/lib/wheel-to-horizontal.ts";

/** A row 900px wide holding 1500px of pills, scrolled to the left end. */
const row = (overrides = {}) => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  scrollLeft: 0,
  scrollWidth: 1500,
  clientWidth: 900,
  ...overrides,
});

test("a wheel down moves the row towards its far end", () => {
  assert.equal(wheelToHorizontalScroll(row({ deltaY: 120 })), 120);
});

test("a wheel up moves it back", () => {
  assert.equal(wheelToHorizontalScroll(row({ deltaY: -120, scrollLeft: 300 })), -120);
});

test("a row with nothing to scroll is left to the page", () => {
  assert.equal(wheelToHorizontalScroll(row({ deltaY: 120, scrollWidth: 900 })), null);
  // Sub-pixel overflow is rounding, not travel.
  assert.equal(wheelToHorizontalScroll(row({ deltaY: 120, scrollWidth: 900.5 })), null);
});

test("an already-horizontal gesture is left to the browser, so it is not doubled", () => {
  assert.equal(wheelToHorizontalScroll(row({ deltaX: 90, deltaY: 20 })), null);
  // Equal deltas are a diagonal trackpad swipe; the browser handles those too.
  assert.equal(wheelToHorizontalScroll(row({ deltaX: 40, deltaY: 40 })), null);
});

test("the step stops at the end rather than overshooting", () => {
  assert.equal(wheelToHorizontalScroll(row({ deltaY: 500, scrollLeft: 400 })), 200);
  assert.equal(wheelToHorizontalScroll(row({ deltaY: -500, scrollLeft: 120 })), -120);
});

test("at the end being pushed towards, the page takes the gesture", () => {
  assert.equal(wheelToHorizontalScroll(row({ deltaY: 120, scrollLeft: 600 })), null);
  assert.equal(wheelToHorizontalScroll(row({ deltaY: -120, scrollLeft: 0 })), null);
  // ...but the other direction still scrolls the row.
  assert.equal(wheelToHorizontalScroll(row({ deltaY: -120, scrollLeft: 600 })), -120);
});

test("line and page deltas are converted, so a Firefox notch is not three pixels", () => {
  assert.equal(wheelToHorizontalScroll(row({ deltaY: 3, deltaMode: 1 })), 48);
  assert.equal(wheelToHorizontalScroll(row({ deltaY: 1, deltaMode: 2 })), 600);
});
