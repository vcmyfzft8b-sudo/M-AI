import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { lessonsToTarget } from "../src/lib/exams/exam-model.ts";
import {
  DONE_SHOWN,
  PATH_ROW_REM,
  PATH_STATION_REM,
  PATH_SWING_REM,
  pathBuddySide,
  pathCurve,
  pathOffset,
  pathPoint,
  gatingModule,
  pathStations,
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

const pathModule = (position, mastery = 0, extra = {}) => ({ topicId: `t${position}`, position, mastery, ...extra });
const kinds = (run) => run.stations.map((station) => station.type);

test("every module shows its own estimate from the start, not only the one being studied", () => {
  const { runs } = pathStations({
    modules: [pathModule(2), pathModule(0), pathModule(1)],
    history: [],
    next: { topicId: "t0", kind: "summary", check: false },
    ahead: true,
    unfolded: new Set(),
    target: 0.9,
  });
  const fresh = lessonsToTarget(0, 0.9);

  assert.ok(fresh > 1);
  // In path order, one run per module.
  assert.deepEqual(runs.map((run) => run.topicId), ["t0", "t1", "t2"]);
  // The module being studied: "Next up", then the rest of its way to the goal.
  assert.deepEqual(kinds(runs[0]), ["next", ...Array(fresh - 1).fill("locked")]);
  assert.equal(runs[0].stations[1].left, fresh - 1);
  // The modules not reached yet: their whole way to the goal, with the count on the first.
  for (const run of runs.slice(1)) {
    assert.deepEqual(kinds(run), Array(fresh).fill("locked"));
    assert.equal(run.stations[0].left, fresh);
  }
  // Each run starts where the one before ended, so the line swings on across modules.
  assert.equal(runs[1].start, runs[0].stations.length);
  assert.equal(runs[2].start, runs[1].start + runs[1].stations.length);
});

test("a weak module's estimate grows; one on its goal needs no more stops", () => {
  const draw = (mastery) =>
    pathStations({
      modules: [pathModule(0, 0.95, { rawMastery: 0.95 }), pathModule(1, mastery, { rawMastery: mastery })],
      history: [{ id: "h1", topicId: "t0", kind: "quiz", score: 1 }],
      next: null,
      ahead: true,
      unfolded: new Set(),
      target: 0.9,
    }).runs;

  const [onGoal, weak] = draw(0.2);
  assert.deepEqual(kinds(onGoal), ["done"]);
  assert.ok(draw(0.2)[1].stations.length > draw(0.6)[1].stations.length);
  assert.equal(weak.stations[0].left, lessonsToTarget(0.2, 0.9));
});

test("past the exam, or archived, only what was done is drawn", () => {
  const { runs } = pathStations({
    modules: [pathModule(0), pathModule(1)],
    history: [{ id: "h1", topicId: "t0", kind: "quiz", score: 0.4 }],
    next: null,
    ahead: false,
    unfolded: new Set(),
    target: 0.9,
  });

  assert.deepEqual(runs.map(kinds), [["done"]]);
});

test("notes still being made stay off the path, and old lessons fold", () => {
  const history = Array.from({ length: DONE_SHOWN + 3 }, (_, index) => ({ id: `h${index}`, topicId: "t0", kind: "quiz", score: 0.5 }));
  const draw = (unfolded) =>
    pathStations({
      modules: [pathModule(0, 0.5), pathModule(1, 0, { pending: true })],
      history,
      next: { topicId: "t0", kind: "quiz", check: false },
      ahead: true,
      unfolded,
      target: 0.9,
    });

  const folded = draw(new Set());
  assert.deepEqual(folded.runs.map((run) => run.topicId), ["t0"]);
  assert.equal(folded.folded.get("t0"), 3);
  assert.equal(folded.runs[0].stations.filter((station) => station.type === "done").length, DONE_SHOWN);
  assert.equal(draw(new Set(["t0"])).folded.size, 0);
});

test("a shut module names the module it really waits on, past ones that cannot be studied", () => {
  const modules = [
    pathModule(0, 0.2, { usable: true }),
    pathModule(1, 0, { usable: false }), // a note still being made, or one the plan does not open
    pathModule(2, 0, { usable: true }),
    pathModule(3, 0, { usable: true }),
  ];
  const usable = (candidate) => candidate.usable;

  assert.equal(gatingModule(modules, "t2", usable)?.topicId, "t0");
  assert.equal(gatingModule(modules, "t3", usable)?.topicId, "t2");
  assert.equal(gatingModule(modules, "t0", usable), null);
  assert.equal(gatingModule([...modules].reverse(), "t2", usable)?.topicId, "t0");
});
