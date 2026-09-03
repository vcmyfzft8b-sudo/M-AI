import assert from "node:assert/strict";
import test from "node:test";

import {
  chargeableSeconds,
  computeTutorAllowance,
  FREE_TUTOR_LIFETIME_SECONDS,
  PAID_TUTOR_DAILY_SECONDS,
} from "../src/lib/tutor-allowance.ts";

const free = (over = {}) => computeTutorAllowance({
  hasPaidAccess: false, hasUnlimitedUsage: false,
  lifetimeSeconds: 0, dailySeconds: 0, creditSeconds: 0, reservedSeconds: 0, ...over,
});
const paid = (over = {}) => computeTutorAllowance({
  hasPaidAccess: true, hasUnlimitedUsage: false,
  lifetimeSeconds: 0, dailySeconds: 0, creditSeconds: 0, reservedSeconds: 0, ...over,
});

test("a free account gets one minute, once", () => {
  assert.equal(free().remainingSeconds, FREE_TUTOR_LIFETIME_SECONDS);
  assert.equal(free().limitSeconds, FREE_TUTOR_LIFETIME_SECONDS);
});

test("the free minute is a lifetime total, not a daily one", () => {
  // Spent yesterday, and today is a new day: it stays spent. That is the whole point.
  assert.equal(free({ lifetimeSeconds: 60, dailySeconds: 0 }).remainingSeconds, 0);
});

test("a free account is never offered credits", () => {
  // Buying an hour of one feature before buying the plan is the wrong order.
  const allowance = free({ lifetimeSeconds: 60, creditSeconds: 3600 });

  assert.equal(allowance.remainingSeconds, 0);
  assert.equal(allowance.creditSeconds, 0);
});

test("a paid account gets half an hour a day", () => {
  assert.equal(paid().remainingSeconds, PAID_TUTOR_DAILY_SECONDS);
  assert.equal(paid().source, "daily");
});

test("the daily allowance is spent before anything bought", () => {
  const allowance = paid({ dailySeconds: 600, creditSeconds: 3600 });

  assert.equal(allowance.source, "daily", "topping up must not throw away the included time");
  assert.equal(allowance.remainingSeconds, PAID_TUTOR_DAILY_SECONDS - 600 + 3600);
});

test("credits take over once the day is gone", () => {
  const allowance = paid({ dailySeconds: PAID_TUTOR_DAILY_SECONDS, creditSeconds: 3600 });

  assert.equal(allowance.source, "credit");
  assert.equal(allowance.remainingSeconds, 3600);
  assert.equal(allowance.usedSeconds, PAID_TUTOR_DAILY_SECONDS);
});

test("a spent day with nothing bought leaves nothing", () => {
  assert.equal(paid({ dailySeconds: PAID_TUTOR_DAILY_SECONDS }).remainingSeconds, 0);
});

test("time handed out and not yet reported counts as spent", () => {
  // Otherwise two tabs are both told the whole allowance is free, and both are right.
  assert.equal(paid({ reservedSeconds: PAID_TUTOR_DAILY_SECONDS }).remainingSeconds, 0);
  assert.equal(free({ reservedSeconds: FREE_TUTOR_LIFETIME_SECONDS }).remainingSeconds, 0);
});

test("overspending never reports negative time left or more used than the limit", () => {
  const allowance = paid({ dailySeconds: PAID_TUTOR_DAILY_SECONDS + 900 });

  assert.equal(allowance.remainingSeconds, 0);
  assert.equal(allowance.usedSeconds, PAID_TUTOR_DAILY_SECONDS);
});

test("an unlimited account is never metered", () => {
  const allowance = computeTutorAllowance({
    hasPaidAccess: false, hasUnlimitedUsage: true,
    lifetimeSeconds: 99999, dailySeconds: 99999, creditSeconds: 0, reservedSeconds: 99999,
  });

  assert.equal(allowance.hasUnlimitedUsage, true);
  assert.ok(allowance.remainingSeconds > PAID_TUTOR_DAILY_SECONDS);
});

test("a slice is charged at what was used, never more than was granted", () => {
  assert.equal(chargeableSeconds(120, 300), 120);
  // A client cannot report an hour against a five-minute slice.
  assert.equal(chargeableSeconds(3600, 300), 300);
  assert.equal(chargeableSeconds(-5, 300), 0);
});

test("a slice with no usable report is charged in full", () => {
  // The reservation model: we gave you the time and you never said otherwise.
  assert.equal(chargeableSeconds(Number.NaN, 300), 300);
});
