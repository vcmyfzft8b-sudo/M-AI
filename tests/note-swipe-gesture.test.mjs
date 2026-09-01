import assert from "node:assert/strict";
import test from "node:test";

import {
  actionsProgress,
  clamp,
  commitDebt,
  createVelocityTracker,
  decayCommitDebt,
  resolveAxis,
  rubberBand,
  shouldOpen,
  springFrames,
  SWIPE_FLICK_VELOCITY,
  SWIPE_MAX_COMMIT_DEBT_PX,
  SWIPE_OVERSHOOT_PX,
  SWIPE_REVEAL_PX,
  SWIPE_RUBBER_BAND_PX,
  SWIPE_TAP_SLOP_PX,
} from "../src/lib/swipe-gesture.ts";

/**
 * Dragging a note row open, at every speed a hand can do it at.
 *
 * The gesture is the kind of thing that looks right the moment you try it and
 * is wrong at some speed you did not try, so the cases below are a sweep rather
 * than a handful of examples: crawl to flick, one sample per frame and six,
 * 60Hz and 120Hz, and the two endings that used to be got wrong — a flick let
 * go of mid-air, and a fast drag that comes to rest on the row before the
 * finger lifts.
 */

/** A finger, sampled the way a touchscreen samples one. */
function drag({
  from = 0,
  distance,
  speed,
  sampleMs = 1000 / 120,
  holdMs = 0,
  startTime = 1000,
}) {
  const durationMs = Math.abs(distance) / speed;
  const samples = [];

  for (let elapsed = sampleMs; elapsed < durationMs; elapsed += sampleMs) {
    samples.push({ x: from + distance * (elapsed / durationMs), time: startTime + elapsed });
  }

  samples.push({ x: from + distance, time: startTime + durationMs });

  // A finger resting on the row before it lifts reports nothing at all.
  return { start: { x: from, time: startTime }, samples, liftTime: startTime + durationMs + holdMs };
}

/**
 * The row, driven by that finger, exactly as the component drives it: axis
 * resolution, slop hand-back, commit debt, rubber band, release decision.
 */
function runGesture(gesture, { startOffset = 0, angleDeg = 0 } = {}) {
  const tracker = createVelocityTracker();
  tracker.reset(gesture.start.x, gesture.start.time);

  const slope = Math.tan((angleDeg * Math.PI) / 180);
  let startX = gesture.start.x;
  let axis = "pending";
  let debt = 0;
  let lastTime = gesture.start.time;
  let lastX = gesture.start.x;
  let committedAt = gesture.start.x;
  let offset = startOffset;
  const painted = [];
  const frames = [];

  for (const sample of gesture.samples) {
    tracker.push(sample.x, sample.time);

    const y = (sample.x - gesture.start.x) * slope;

    if (axis === "pending") {
      const resolved = resolveAxis(sample.x - startX, y);

      if (resolved === "pending") {
        continue;
      }

      if (resolved === "y") {
        return { axis: "y", painted, frames, offset: startOffset, velocity: 0, open: false };
      }

      const deltaX = sample.x - startX;
      committedAt = sample.x;
      axis = "x";
      startX += deltaX < 0 ? -SWIPE_TAP_SLOP_PX : SWIPE_TAP_SLOP_PX;
      debt = commitDebt(deltaX);
      lastTime = sample.time;
      lastX = sample.x;
    }

    debt = decayCommitDebt(debt, sample.time - lastTime, sample.x - lastX);
    lastTime = sample.time;
    lastX = sample.x;
    offset = rubberBand(startOffset + (sample.x - startX)) - debt;
    painted.push(offset);
    // What the finger is asking for, against what the row gave it.
    frames.push({
      finger: startOffset + (sample.x - gesture.start.x),
      offset,
      sinceCommit: Math.abs(sample.x - committedAt),
    });
  }

  if (axis !== "x") {
    return { axis, painted, frames, offset: startOffset, velocity: 0, open: false };
  }

  const last = gesture.samples[gesture.samples.length - 1];
  const velocity = tracker.read(gesture.liftTime);
  const settleFrom = rubberBand(startOffset + (last.x - startX));

  return {
    axis,
    painted,
    frames,
    offset: settleFrom,
    velocity,
    open: shouldOpen(settleFrom, velocity),
  };
}

/** px/ms: a slow read of a list, a normal swipe, and a proper flick. */
const SPEEDS = [0.02, 0.05, 0.1, 0.2, 0.4, 0.8, 1.5, 3, 6];
const SAMPLE_RATES = [1000 / 120, 1000 / 60, 1000 / 30];

test("a swipe long enough to open the row opens it at every speed", () => {
  for (const speed of SPEEDS) {
    for (const sampleMs of SAMPLE_RATES) {
      const result = runGesture(drag({ distance: -120, speed, sampleMs }));

      assert.equal(result.axis, "x", `speed ${speed} @ ${sampleMs}ms lost the gesture`);
      assert.equal(result.open, true, `speed ${speed} @ ${sampleMs}ms did not open`);
    }
  }
});

test("a short pull that is let go of gently falls back shut, however fast it was", () => {
  for (const speed of SPEEDS) {
    // Ends well short of the halfway mark and stops dead before the lift, so
    // there is no flick left to carry it.
    const result = runGesture(drag({ distance: -40, speed, holdMs: 200 }));

    assert.equal(result.open, false, `speed ${speed} opened on 40px`);
  }
});

test("a flick opens the row on speed alone, long after it stopped being far enough", () => {
  // 30px is a fifth of the travel — position says shut, the flick says open.
  for (const speed of [0.5, 1, 2, 4]) {
    const result = runGesture(drag({ distance: -30, speed }));

    assert.ok(
      result.velocity < -SWIPE_FLICK_VELOCITY,
      `${speed}px/ms read as ${result.velocity.toFixed(3)}px/ms`,
    );
    assert.equal(result.open, true, `a ${speed}px/ms flick did not open the row`);
  }
});

test("a flick that comes to rest before the finger lifts is not a flick", () => {
  // The bug this covers: the row flew open a full second after the hand had
  // stopped, because the smoothed velocity it was decided on never expired.
  for (const holdMs of [120, 400, 2000]) {
    const result = runGesture(drag({ distance: -30, speed: 3, holdMs }));

    assert.equal(result.velocity, 0, `${holdMs}ms of stillness still read as movement`);
    assert.equal(result.open, false, `a row held still for ${holdMs}ms still flicked open`);
  }
});

test("a flick right closes an open row, from anywhere in the travel", () => {
  for (const speed of [0.5, 1, 3]) {
    const result = runGesture(drag({ distance: 20, speed }), { startOffset: -SWIPE_REVEAL_PX });

    assert.equal(result.open, false, `a ${speed}px/ms flick right left the row open`);
  }
});

test("the row keeps up with the finger — no distance is dropped at any speed", () => {
  for (const speed of SPEEDS) {
    for (const sampleMs of SAMPLE_RATES) {
      const { frames } = runGesture(drag({ distance: -130, speed, sampleMs }));

      for (const { finger, offset, sinceCommit } of frames) {
        // The tap slop is the one thing the row is allowed to keep; on top of
        // it, only the opening step it is still easing into.
        const lag = Math.abs(offset - (finger + SWIPE_TAP_SLOP_PX));

        assert.ok(
          lag <= SWIPE_MAX_COMMIT_DEBT_PX + 1e-9,
          `speed ${speed} @ ${sampleMs}ms fell ${lag.toFixed(1)}px behind the finger`,
        );

        // ...and a centimetre after the swipe was recognised, not even that.
        if (sinceCommit > 40) {
          assert.ok(
            lag < 0.5,
            `speed ${speed} @ ${sampleMs}ms was still ${lag.toFixed(1)}px behind at ${finger.toFixed(0)}px`,
          );
        }
      }
    }
  }
});

test("the row never jumps when the swipe is recognised", () => {
  for (const speed of SPEEDS) {
    const result = runGesture(drag({ distance: -130, speed }));
    const [first] = result.painted;

    assert.ok(
      Math.abs(first) <= SWIPE_MAX_COMMIT_DEBT_PX + 1e-9 || speed > 0.5,
      `speed ${speed} opened with a ${Math.abs(first).toFixed(1)}px step`,
    );

    // ...and whatever it held back is handed over inside a few frames, never
    // left behind as permanent lag.
    const settled = result.painted.filter((_, index) => index > 12);

    if (settled.length > 0) {
      assert.ok(
        Math.abs(result.painted[13] - result.painted[12]) < 60,
        `speed ${speed} was still catching up after 13 frames`,
      );
    }
  }
});

test("the row only ever moves the way the finger does", () => {
  for (const speed of SPEEDS) {
    const { painted } = runGesture(drag({ distance: -140, speed }));

    for (let index = 1; index < painted.length; index += 1) {
      assert.ok(
        painted[index] <= painted[index - 1] + 1e-6,
        `speed ${speed} backtracked at frame ${index}`,
      );
    }
  }
});

test("a gesture that leans vertical is handed to the list", () => {
  for (const angleDeg of [60, 75, 89]) {
    for (const speed of SPEEDS) {
      const result = runGesture(drag({ distance: -140, speed }), { angleDeg });

      assert.equal(result.axis, "y", `${angleDeg}° at ${speed}px/ms was taken as a swipe`);
    }
  }
});

test("a gesture that leans horizontal — even an arcing flick — stays the row's", () => {
  for (const angleDeg of [0, 20, 40, 55]) {
    for (const speed of SPEEDS) {
      const result = runGesture(drag({ distance: -140, speed }), { angleDeg });

      assert.equal(result.axis, "x", `${angleDeg}° at ${speed}px/ms was given away`);
    }
  }
});

test("resolveAxis waits for a direction rather than reading the first jerk", () => {
  assert.equal(resolveAxis(0, 0), "pending");
  assert.equal(resolveAxis(-6, 5), "pending");
  assert.equal(resolveAxis(-12, 4), "x");
  assert.equal(resolveAxis(-4, 12), "y");
  // Diagonal-ish is the row's: the browser keeps its veto over vertical pans.
  assert.equal(resolveAxis(-9, 12), "x");
});

test("the rubber band gives way and then stops giving", () => {
  assert.equal(rubberBand(0), 0);
  assert.equal(rubberBand(-40), -40);
  assert.equal(rubberBand(-SWIPE_REVEAL_PX), -SWIPE_REVEAL_PX);

  let previous = 0;

  for (let pull = 1; pull <= 4000; pull += 1) {
    const past = rubberBand(pull) ;
    const beyond = -rubberBand(-SWIPE_REVEAL_PX - pull) - SWIPE_REVEAL_PX;

    assert.ok(past > previous - 1e-9, "the row stopped following the finger");
    assert.ok(past < pull, "the row followed the finger at full speed past the end");
    assert.ok(past < SWIPE_RUBBER_BAND_PX, `overshot to ${past.toFixed(1)}px`);
    assert.ok(beyond < SWIPE_RUBBER_BAND_PX, `overshot to ${beyond.toFixed(1)}px`);
    previous = past;
  }

  // A hard pull is most of the way to the limit and never past it.
  assert.ok(rubberBand(600) > SWIPE_RUBBER_BAND_PX * 0.7);
});

test("the actions come out with the row and are all the way out when it is", () => {
  assert.equal(actionsProgress(0), 0);
  assert.equal(actionsProgress(-SWIPE_REVEAL_PX / 2), 0.5);
  assert.equal(actionsProgress(-SWIPE_REVEAL_PX), 1);
  // Rubber-banded past either end, they stay put rather than inverting.
  assert.equal(actionsProgress(-SWIPE_REVEAL_PX - 60), 1);
  assert.equal(actionsProgress(30), 0);
});

test("the settle picks up the speed the finger let go at", () => {
  const gentle = springFrames(-70, -SWIPE_REVEAL_PX, 0);
  const flung = springFrames(-70, -SWIPE_REVEAL_PX, -2);

  for (const frames of [gentle, flung]) {
    assert.equal(frames.offsets[0], -70, "the settle did not start where the row was");
    assert.equal(frames.offsets[frames.offsets.length - 1], -SWIPE_REVEAL_PX);
    assert.equal(frames.durationMs, (frames.offsets.length - 1) * (1000 / 120));
  }

  // The first frame of the flung settle carries the flick; the gentle one eases.
  const flungStep = Math.abs(flung.offsets[1] - flung.offsets[0]);
  const gentleStep = Math.abs(gentle.offsets[1] - gentle.offsets[0]);

  assert.ok(flungStep > gentleStep * 3, "the release stalled the flick");
  assert.ok(flung.durationMs < gentle.durationMs, "the flung row took longer to land");
});

test("no settle wanders off the row, bounces, or runs long", () => {
  // Including the two that only the rubber band can produce: let go of well
  // past either end, which is further out than any overshoot the spring itself
  // is allowed.
  for (const from of [-SWIPE_REVEAL_PX - 40, -SWIPE_REVEAL_PX, -90, -20, 0, 30]) {
    for (const to of [0, -SWIPE_REVEAL_PX]) {
      for (const velocity of [-6, -3, -1, -0.2, 0, 0.2, 1, 3, 6]) {
        const { offsets, durationMs } = springFrames(from, to, velocity);

        assert.ok(durationMs <= 700, `settle ran ${durationMs.toFixed(0)}ms`);
        assert.ok(offsets.length >= 1);

        // The row may start deep in the rubber band; what it may not do is be
        // carried further out than it already was.
        const floor = Math.min(-SWIPE_REVEAL_PX - SWIPE_OVERSHOOT_PX, from);
        const ceiling = Math.max(SWIPE_OVERSHOOT_PX, from);

        assert.equal(offsets[0], from, "the settle did not start where the row was");

        for (const offset of offsets) {
          assert.ok(
            offset <= ceiling + 1e-9 && offset >= floor - 1e-9,
            `settle reached ${offset.toFixed(1)}px`,
          );
        }

        // At most one turn: it may carry past the target once, never wobble.
        let turns = 0;

        for (let index = 2; index < offsets.length; index += 1) {
          const before = Math.sign(offsets[index - 1] - offsets[index - 2]);
          const after = Math.sign(offsets[index] - offsets[index - 1]);

          if (before !== 0 && after !== 0 && before !== after) {
            turns += 1;
          }
        }

        assert.ok(turns <= 1, `settle from ${from} at ${velocity}px/ms wobbled ${turns} times`);
      }
    }
  }
});

test("a settle that has nowhere to go is not animated at all", () => {
  const { offsets, durationMs } = springFrames(-SWIPE_REVEAL_PX, -SWIPE_REVEAL_PX, 0);

  assert.equal(durationMs, 0);
  assert.deepEqual(offsets, [-SWIPE_REVEAL_PX]);
});

test("the settle is sampled for a 120Hz display", () => {
  const { offsets, durationMs } = springFrames(0, -SWIPE_REVEAL_PX, 0);

  assert.ok(offsets.length > 20, "too few frames to be smooth");
  assert.ok(Math.abs(durationMs / (offsets.length - 1) - 1000 / 120) < 1e-9);
});

test("velocity is read over the recent past, not the whole gesture", () => {
  const tracker = createVelocityTracker();
  tracker.reset(0, 0);

  // 200ms of crawling, then a flick over the last 30ms.
  for (let time = 8; time <= 200; time += 8) {
    tracker.push(-time * 0.02, time);
  }

  const crawl = tracker.read(200);
  assert.ok(Math.abs(crawl + 0.02) < 0.005, `crawl read as ${crawl}`);

  for (let time = 208; time <= 230; time += 8) {
    tracker.push(-4 - (time - 200) * 2, time);
  }

  const flick = tracker.read(230);
  assert.ok(flick < -0.9, `the flick after the crawl read as ${flick}`);
  assert.ok(flick < crawl * 20, "the crawl before it swallowed the flick");
});

test("a gesture over in a single frame still has a speed", () => {
  const tracker = createVelocityTracker();
  tracker.reset(0, 0);
  tracker.push(-24, 8);

  assert.ok(Math.abs(tracker.read(9) + 3) < 1e-9);
});

test("the commit debt is small, signed with the drag, and gone quickly", () => {
  assert.equal(commitDebt(-9), -5);
  assert.equal(commitDebt(9), 5);
  assert.equal(commitDebt(-80), -SWIPE_MAX_COMMIT_DEBT_PX);
  assert.equal(commitDebt(80), SWIPE_MAX_COMMIT_DEBT_PX);

  let debt = commitDebt(-9);

  for (let frame = 0; frame < 12; frame += 1) {
    debt = decayCommitDebt(debt, 1000 / 120);
  }

  assert.equal(debt, 0, "the row was still holding distance back after 100ms");
});

test("clamp", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
});
