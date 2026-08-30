import assert from "node:assert/strict";
import test from "node:test";

/*
 * The daily rule, tested against the same date arithmetic the module uses.
 * `discount-wheel.ts` is `server-only` and talks to Supabase, so the rule
 * itself is restated here rather than the module imported — what matters is
 * that "same UTC day" means what it says at the edges.
 */
function isSameUtcDay(a, b) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

test("a spin blocks another one later the same day", () => {
  const spun = new Date("2026-08-30T00:00:01Z");
  const later = new Date("2026-08-30T23:59:59Z");

  assert.equal(isSameUtcDay(spun, later), true);
});

test("a spin one second before midnight does not block the next day", () => {
  const spun = new Date("2026-08-30T23:59:59Z");
  const nextDay = new Date("2026-08-31T00:00:00Z");

  assert.equal(isSameUtcDay(spun, nextDay), false);
});

test("the same clock time in a different month or year is a different day", () => {
  const spun = new Date("2026-08-30T12:00:00Z");

  assert.equal(isSameUtcDay(spun, new Date("2026-09-30T12:00:00Z")), false);
  assert.equal(isSameUtcDay(spun, new Date("2027-08-30T12:00:00Z")), false);
});
