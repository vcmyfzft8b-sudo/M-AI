import assert from "node:assert/strict";
import test from "node:test";

import {
  PATH_ROW_REM,
  PATH_STATION_REM,
  PATH_SWING_REM,
  pathBuddySide,
  pathOffset,
  pathSegment,
} from "../src/lib/exams/exam-path.ts";

test("the path starts in the middle and swings within its bounds", () => {
  assert.equal(pathOffset(0), 0);
  assert.equal(pathOffset(2), PATH_SWING_REM);
  assert.equal(pathOffset(6), -PATH_SWING_REM);

  for (let index = 0; index < 60; index += 1) {
    assert.ok(Math.abs(pathOffset(index)) <= PATH_SWING_REM);
  }

  // A station at the far swing still fits a 375px phone (23.4rem) with the 16px gutters.
  assert.ok(PATH_SWING_REM + PATH_STATION_REM / 2 <= 23.4 / 2 - 1);
});

test("each segment joins one station's centre to the next one's", () => {
  for (let index = 0; index < 16; index += 1) {
    const { length, angle } = pathSegment(index);
    const radians = (angle * Math.PI) / 180;
    const dx = pathOffset(index + 1) - pathOffset(index);

    assert.ok(Math.abs(length * Math.cos(radians) - dx) < 0.02);
    assert.ok(Math.abs(length * Math.sin(radians) - PATH_ROW_REM) < 0.02);
  }
});

test("Memo stands on the side the path is not swinging to", () => {
  assert.equal(pathBuddySide(0), "right");
  assert.equal(pathBuddySide(2), "left");
  assert.equal(pathBuddySide(6), "right");
});
