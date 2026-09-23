import assert from "node:assert/strict";
import { test } from "node:test";

import { createClockAlignment, isKeyboardSpring, springInset, springRemaining } from "../src/lib/mobile/keyboard-spring.ts";

// Measured on iOS 26: UIKit's keyboard spring.
const keyboard = { omega: Math.sqrt(555.0265), zeta: 47.118 / (2 * Math.sqrt(555.0265)), duration: 0.3833 };

test("the keyboard spring starts at rest, is critically damped and settles by its duration", () => {
  assert.equal(springRemaining(keyboard, 0), 1);
  assert.ok(Math.abs(keyboard.zeta - 1) < 1e-3, "iOS uses a critically damped spring");
  // Half the distance is covered at about 71 ms, and nothing overshoots.
  assert.ok(Math.abs(springRemaining(keyboard, 0.0712) - 0.5) < 0.01);
  let previous = 1;
  for (let t = 0.005; t < keyboard.duration; t += 0.005) {
    const value = springRemaining(keyboard, t);
    assert.ok(value <= previous && value >= 0, `monotonic at ${t}`);
    previous = value;
  }
  assert.ok(springRemaining(keyboard, 0.38) < 0.002);
  assert.equal(springRemaining(keyboard, keyboard.duration), 0);
});

test("the inset rises from 0 to the keyboard as the keys come up, and back down", () => {
  const up = { ...keyboard, offset: 308, target: 308, elapsed: 0, sentAt: 0 };
  assert.equal(springInset(up, 0), 0);
  assert.ok(Math.abs(springInset(up, 0.0712) - 154) < 3);
  assert.equal(springInset(up, 1), 308);
  const down = { ...keyboard, offset: -308, target: 0, elapsed: 0, sentAt: 0 };
  assert.equal(springInset(down, 0), 308);
  assert.equal(springInset(down, 1), 0);
});

test("under- and over-damped springs are still exact at the ends", () => {
  for (const zeta of [0.6, 1.4]) {
    const spring = { omega: 20, zeta, duration: 2 };
    assert.ok(Math.abs(springRemaining(spring, 1e-6) - 1) < 1e-6);
    assert.ok(Math.abs(springRemaining(spring, 1.99)) < 0.02);
  }
});

test("the clock alignment keeps the fastest delivery", () => {
  const clock = createClockAlignment();
  assert.ok(Number.isNaN(clock.native(1000)));
  clock.observe(10, 5008); // 8 ms late
  clock.observe(10.1, 5102); // 2 ms late: the better estimate
  clock.observe(10.2, 5215);
  assert.ok(Math.abs(clock.native(5102) - 10.1) < 1e-9);
});

test("malformed spring payloads are ignored", () => {
  assert.equal(isKeyboardSpring(undefined), false);
  assert.equal(isKeyboardSpring({ offset: 1 }), false);
  assert.equal(isKeyboardSpring({ offset: 1, omega: 0, zeta: 1, duration: 1, elapsed: 0, sentAt: 0, target: 0 }), false);
  assert.equal(isKeyboardSpring({ offset: 308, omega: 23.5, zeta: 1, duration: 0.38, elapsed: 0.01, sentAt: 5, target: 308 }), true);
});
