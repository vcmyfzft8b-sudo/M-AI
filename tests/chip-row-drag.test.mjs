import assert from "node:assert/strict";
import test from "node:test";

import {
  CHIP_DRAG_SLOP_PX,
  chipRowDragScrollLeft,
  shouldStartChipRowDrag,
} from "../src/lib/chip-row-drag.ts";

const start = { pointerX: 500, scrollLeft: 120 };

test("a short move is still a click, so pressing a pill is never eaten", () => {
  assert.equal(chipRowDragScrollLeft(start, 500 + CHIP_DRAG_SLOP_PX - 1, false), null);
  assert.equal(chipRowDragScrollLeft(start, 500 - CHIP_DRAG_SLOP_PX + 1, false), null);
});

test("past the slop the row follows the hand, the other way round", () => {
  // Hand moves left 100px, so the content comes 100px further along.
  assert.equal(chipRowDragScrollLeft(start, 400, false), 220);
  assert.equal(chipRowDragScrollLeft(start, 600, false), 20);
});

test("once it is a drag it stays one, even back through the start point", () => {
  assert.equal(chipRowDragScrollLeft(start, 502, true), 118);
  assert.equal(chipRowDragScrollLeft(start, 500, true), 120);
});

test("the offset is measured from where the press landed, not from zero", () => {
  assert.equal(chipRowDragScrollLeft({ pointerX: 900, scrollLeft: 0 }, 800, false), 100);
});

const row = (overrides = {}) => ({
  pointerType: "mouse",
  button: 0,
  scrollWidth: 1500,
  clientWidth: 900,
  ...overrides,
});

test("a mouse starts a drag", () => {
  assert.equal(shouldStartChipRowDrag(row()), true);
  assert.equal(shouldStartChipRowDrag(row({ pointerType: "pen" })), true);
});

test("touch is left to the browser's own panning", () => {
  assert.equal(shouldStartChipRowDrag(row({ pointerType: "touch" })), false);
});

test("only the primary button, and only a row with somewhere to go", () => {
  assert.equal(shouldStartChipRowDrag(row({ button: 2 })), false);
  assert.equal(shouldStartChipRowDrag(row({ button: 1 })), false);
  assert.equal(shouldStartChipRowDrag(row({ scrollWidth: 900 })), false);
  assert.equal(shouldStartChipRowDrag(row({ scrollWidth: 900.5 })), false);
});
