import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PATH_ROW_REM,
  PATH_STATION_REM,
  PATH_SWING_REM,
  pathBuddySide,
  pathCurve,
  pathOffset,
  pathPoint,
} from "../src/lib/exams/exam-path.ts";

test("the path starts in the middle and swings within its bounds", () => {
  assert.equal(pathOffset(0), 0);
  assert.equal(pathOffset(2), PATH_SWING_REM);
  assert.equal(pathOffset(6), -PATH_SWING_REM);

  for (let index = 0; index < 60; index += 1) {
    assert.ok(Math.abs(pathOffset(index)) <= PATH_SWING_REM);
  }

  // A stop at the far swing, the next one's larger node included, still fits a 375px phone
  // (23.4rem) inside its 16px gutters.
  assert.ok(PATH_SWING_REM + 5.4 / 2 <= 23.4 / 2 - 1);
});

test("stops sit a row apart, centred on their node", () => {
  assert.deepEqual(pathPoint(0, 0), { x: 0, y: PATH_STATION_REM / 2 });
  assert.equal(pathPoint(5, 3).y, Math.round((3 * PATH_ROW_REM + PATH_STATION_REM / 2) * 100) / 100);
  assert.equal(pathPoint(5, 3).x, pathOffset(5));
});

test("the line passes through every stop, without corners", () => {
  const points = [0, 1, 2, 3, 4].map((row) => pathPoint(row + 1, row));
  const data = pathCurve(points);
  const ends = [...data.matchAll(/(-?[\d.]+) (-?[\d.]+)(?=\s*C|$)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));

  assert.ok(data.startsWith(`M ${points[0].x} ${points[0].y}`));
  assert.equal((data.match(/C /g) ?? []).length, points.length - 1);

  // Every curve ends on the next stop's centre.
  const segmentEnds = data.split(" C ").slice(1).map((part) => part.split(", ").pop().split(" ").map(Number));
  segmentEnds.forEach(([x, y], index) => {
    assert.ok(Math.abs(x - points[index + 1].x) < 0.01 && Math.abs(y - points[index + 1].y) < 0.01);
  });
  assert.ok(ends.length > 0);

  // One stop draws nothing to join; none draws nothing at all.
  assert.equal(pathCurve([points[0]]), `M ${points[0].x} ${points[0].y}`);
  assert.equal(pathCurve([]), "");
});

test("Memo stands on the side the path is not swinging to", () => {
  assert.equal(pathBuddySide(0), "right");
  assert.equal(pathBuddySide(2), "left");
  assert.equal(pathBuddySide(6), "right");
});

test("a stop's pills slide in rather than leave the path on a wide swing", () => {
  const css = readFileSync(new URL("../src/app/redesign.css", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../src/components/exams/exam-dashboard.tsx", import.meta.url), "utf8");

  // The path measures itself, each stop says how far it swings, and every pill is clamped to the path.
  assert.match(css, /\.memo-path \{[^}]*container-type: inline-size;/);
  assert.match(css, /\.memo-path-stop \{[^}]*left: calc\(50% \+ var\(--x, 0rem\)\);/);
  assert.match(
    css,
    /:is\(\.memo-path-label, \.memo-path-next, \.memo-path-left\) \{\s*translate: clamp\(calc\(50% - 50cqw - var\(--x, 0rem\)\), 0px, calc\(50cqw - var\(--x, 0rem\) - 50%\)\) 0;/,
  );
  assert.match(dashboard, /"--x": `\$\{points\[row\]\.x\}rem`/);
});
