import assert from "node:assert/strict";
import test from "node:test";

import {
  fixedMonthlyCents,
  monthWindow,
  projectMetered,
  shareBefore,
  summarizeStripeBalance,
  totalCosts,
  usdToEurCents,
} from "../src/lib/admin/costs-math.ts";

/**
 * The running-costs table is read mid-month to decide whether something is
 * getting out of hand, so the projection must not be fooled by the date and a
 * provider that does not answer must show as missing, never as €0.
 */

test("a month is a Ljubljana calendar month", () => {
  const window = monthWindow("2026-09", new Date("2026-10-02T10:00:00Z"));

  assert.equal(window.from, "2026-09-01");
  assert.equal(window.to, "2026-09-30");
  // Midnight in Ljubljana (CEST, UTC+2) on both ends.
  assert.equal(window.fromIso, "2026-08-31T22:00:00.000Z");
  assert.equal(window.toIso, "2026-09-30T22:00:00.000Z");
  assert.equal(window.isCurrent, false);
  assert.equal(window.elapsed, 1);
  // Day-metered providers are asked for the UTC month instead.
  assert.equal(window.utcFromIso, "2026-09-01T00:00:00.000Z");
  assert.equal(window.utcToIso, "2026-10-01T00:00:00.000Z");
});

test("the current month knows how much of it has passed", () => {
  // Noon on 16 September in Ljubljana: just over half of a 30-day month.
  const window = monthWindow("2026-09", new Date("2026-09-16T10:00:00Z"));

  assert.equal(window.isCurrent, true);
  assert.ok(Math.abs(window.elapsed - 15.5 / 30) < 0.001);
  // December's window ends at January's first midnight (CET, UTC+1).
  assert.equal(monthWindow("2026-12").toIso, "2026-12-31T23:00:00.000Z");
});

test("metered costs are projected at the month's pace, fixed ones are not", () => {
  const half = monthWindow("2026-09", new Date("2026-09-16T10:00:00Z"));

  assert.equal(projectMetered(1000, half), Math.round(1000 / half.elapsed));
  assert.equal(projectMetered(null, half), null);

  // A finished month is what it was.
  const past = monthWindow("2026-08", new Date("2026-10-02T10:00:00Z"));
  assert.equal(projectMetered(1234, past), 1234);

  // The first hours of a month are too thin to multiply by thirty.
  const firstMorning = monthWindow("2026-10", new Date("2026-10-01T06:00:00Z"));
  assert.equal(projectMetered(500, firstMorning), null);
});

test("dollars and yearly fees come to the right euro cents a month", () => {
  const eurPerUsd = 1 / 1.1355;

  assert.equal(usdToEurCents(42.63, eurPerUsd), 3754);
  assert.equal(fixedMonthlyCents({ amount: 99, currency: "eur", cadence: "yearly" }, eurPerUsd), 825);
  assert.equal(fixedMonthlyCents({ amount: "25.00", currency: "usd", cadence: "monthly" }, eurPerUsd), 2202);
  assert.equal(fixedMonthlyCents({ amount: 0, currency: "eur", cadence: "monthly" }, eurPerUsd), 0);
});

test("Stripe's fees include its own Billing charges, and refunds are money out", () => {
  const month = summarizeStripeBalance([
    { type: "charge", amount: 6500, fee: 120 },
    { type: "payment", amount: 1000, fee: 40 },
    { type: "refund", amount: -6500, fee: 0 },
    { type: "stripe_fee", amount: -368, fee: 0 },
    { type: "payout", amount: -50000, fee: 0 },
  ]);

  assert.deepEqual(month, { gross: 7500, refunds: 6500, fees: 528 });
});

test("a source that did not answer is missing from the total, not zero", () => {
  const totals = totalCosts([
    { key: "a", label: "A", kind: "metered", soFar: 1000, projected: 2000, note: "" },
    { key: "b", label: "B", kind: "metered", soFar: null, projected: null, note: "down" },
    { key: "c", label: "C", kind: "fixed", soFar: 500, projected: 500, note: "" },
  ]);

  assert.deepEqual(totals, { soFar: 1500, projected: 2500, missing: 1 });
});

test("a month too young to project says so instead of passing a morning off as a month", () => {
  const totals = totalCosts([
    { key: "a", label: "A", kind: "metered", soFar: 300, projected: null, note: "" },
    { key: "c", label: "C", kind: "fixed", soFar: 500, projected: 500, note: "" },
  ]);

  assert.equal(totals.projected, null);
  assert.equal(totals.soFar, 800);
});

test("a reading that has seen less of the month is projected over what it saw", () => {
  const window = monthWindow("2026-09", new Date("2026-09-16T10:00:00Z"));
  const covered = shareBefore(window.utcFromIso, window.utcToIso, "2026-09-16T10:00:00.000Z");

  // 15 days and 10 hours of a 30-day UTC month.
  assert.ok(Math.abs(covered - (15 + 10 / 24) / 30) < 1e-9);
  assert.equal(projectMetered(1000, window, covered), Math.round(1000 / covered));
});
