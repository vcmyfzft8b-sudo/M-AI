import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  dayStartIso,
  daysBetween,
  eachDay,
  formatHourLabel,
  hourInReportZone,
  monthsCovered,
  normalizeRangePreset,
  percentChange,
  rangeToTimestamps,
  resolveRange,
  todayInReportZone,
} from "../src/lib/admin/ranges.ts";

test("resolves the reporting day in Ljubljana, not UTC", () => {
  // 22:30 UTC on 18 August is already 00:30 on the 19th in Ljubljana (CEST).
  // Bucketing this by UTC would put a late-evening post on the wrong day.
  assert.equal(todayInReportZone(new Date("2026-08-18T22:30:00Z")), "2026-08-19");
  assert.equal(todayInReportZone(new Date("2026-08-18T21:30:00Z")), "2026-08-18");
});

test("resolves the reporting day across the winter offset too", () => {
  // In CET the switch is at 23:00 UTC rather than 22:00.
  assert.equal(todayInReportZone(new Date("2026-01-18T23:30:00Z")), "2026-01-19");
  assert.equal(todayInReportZone(new Date("2026-01-18T22:30:00Z")), "2026-01-18");
});

test("day bounds are real Ljubljana midnights, matching the SQL aggregates", () => {
  // The SQL functions bucket on `at time zone 'Europe/Ljubljana'`. If these
  // bounds were UTC midnights the query window would sit an hour or two out of
  // step with the days it is supposed to cover.
  assert.equal(dayStartIso("2026-08-19"), "2026-08-18T22:00:00.000Z");
  assert.equal(dayStartIso("2026-01-19"), "2026-01-18T23:00:00.000Z");
});

test("a range covers exactly its days, end exclusive", () => {
  const { fromIso, toIso } = rangeToTimestamps({
    from: "2026-08-18",
    to: "2026-08-19",
  });

  assert.equal(fromIso, "2026-08-17T22:00:00.000Z");
  assert.equal(toIso, "2026-08-19T22:00:00.000Z");
});

test("date arithmetic stays on calendar days across a DST boundary", () => {
  // 25 October 2026 is the CEST -> CET switch. Naive 24h arithmetic would
  // produce a duplicated or skipped day here.
  assert.equal(addDays("2026-10-24", 1), "2026-10-25");
  assert.equal(addDays("2026-10-25", 1), "2026-10-26");
  assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2);
  assert.deepEqual(eachDay("2026-10-24", "2026-10-26"), [
    "2026-10-24",
    "2026-10-25",
    "2026-10-26",
  ]);
});

test("the 7-day preset is inclusive of today and 6 days back", () => {
  const range = resolveRange("7d", { now: new Date("2026-08-19T10:00:00Z") });

  assert.equal(range.from, "2026-08-13");
  assert.equal(range.to, "2026-08-19");
  assert.equal(range.days.length, 7);
});

test("the previous window is the same length and does not overlap", () => {
  const range = resolveRange("7d", { now: new Date("2026-08-19T10:00:00Z") });

  assert.deepEqual(range.previous, { from: "2026-08-06", to: "2026-08-12" });
  assert.equal(daysBetween(range.previous.from, range.previous.to), 6);
  assert.ok(range.previous.to < range.from, "windows must not overlap");
});

test("today's window is a single day and compares against yesterday", () => {
  const range = resolveRange("today", { now: new Date("2026-08-19T10:00:00Z") });

  assert.deepEqual(range.days, ["2026-08-19"]);
  assert.deepEqual(range.previous, { from: "2026-08-18", to: "2026-08-18" });
});

test("the month window starts on the first of the month", () => {
  const range = resolveRange("month", { now: new Date("2026-08-19T10:00:00Z") });

  assert.equal(range.from, "2026-08-01");
  assert.equal(range.to, "2026-08-19");
});

test("all-time starts at the earliest data we hold, but never unbounded", () => {
  const withData = resolveRange("all", {
    now: new Date("2026-08-19T10:00:00Z"),
    earliestDay: "2026-08-01",
  });
  assert.equal(withData.from, "2026-08-01");
  // Nothing to compare an all-time window against.
  assert.equal(withData.previous, null);

  // An implausibly old first day is clamped so the chart cannot grow unbounded.
  const ancient = resolveRange("all", {
    now: new Date("2026-08-19T10:00:00Z"),
    earliestDay: "2019-01-01",
  });
  assert.equal(ancient.from, "2025-08-19");
});

test("an unknown range falls back to 7 days rather than throwing", () => {
  assert.equal(normalizeRangePreset("nonsense"), "7d");
  assert.equal(normalizeRangePreset(undefined), "7d");
  assert.equal(normalizeRangePreset("month"), "month");
});

test("percent change reports no baseline rather than dividing by zero", () => {
  assert.equal(percentChange(50, 100), -50);
  assert.equal(percentChange(150, 100), 50);
  assert.equal(percentChange(0, 0), 0);
  // Growth from nothing has no meaningful percentage.
  assert.equal(percentChange(10, 0), null);
});

/**
 * The day view charts hourly buckets, and the hour a bucket belongs to is the
 * hour in Ljubljana, not in UTC. Getting this wrong shifts the whole chart by
 * one or two hours depending on the season, which is exactly the kind of thing
 * nobody notices until the evening traffic looks like afternoon traffic.
 */
test("hourInReportZone reads the hour in Ljubljana, not UTC", () => {
  // Central European Summer Time, UTC+2.
  assert.equal(hourInReportZone(new Date("2026-08-19T19:45:21Z")), 21);
  // Central European Time, UTC+1.
  assert.equal(hourInReportZone(new Date("2026-01-15T19:45:21Z")), 20);
  // Crossing midnight locally while UTC is still on the previous day.
  assert.equal(hourInReportZone(new Date("2026-08-19T22:30:00Z")), 0);
  // Midnight itself, so the hourly axis starts at 00 rather than 24.
  assert.equal(hourInReportZone(new Date("2026-08-19T00:15:00Z")), 2);
});

test("formatHourLabel pads to a stable two-digit axis label", () => {
  assert.equal(formatHourLabel(0), "00:00");
  assert.equal(formatHourLabel(9), "09:00");
  assert.equal(formatHourLabel(23), "23:00");
});

/**
 * A monthly retainer is pro-rated by this, so an error here quietly pays a
 * creator the wrong amount. The point of counting per day is that a day is not
 * a fixed fraction of a month: February days are worth more than March days.
 */
test("monthsCovered pro-rates a retainer by real month lengths", () => {
  const august = eachDay("2026-08-01", "2026-08-31");
  assert.equal(monthsCovered(august), 1);

  // 2026 is not a leap year, so February is 28 days and still one whole month.
  const february = eachDay("2026-02-01", "2026-02-28");
  assert.equal(monthsCovered(february), 1);

  // A seven-day window inside a 31-day month.
  assert.equal(monthsCovered(eachDay("2026-08-13", "2026-08-19")), 7 / 31);

  // Spanning a month boundary: one February day plus one March day, each worth
  // its own month's fraction rather than a shared average.
  assert.equal(
    monthsCovered(eachDay("2026-02-28", "2026-03-01")),
    1 / 28 + 1 / 31,
  );

  assert.equal(monthsCovered([]), 0);
});
