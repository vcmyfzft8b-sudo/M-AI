import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultPayoutPeriod,
  formatEuros,
  formatPeriod,
  isPeriodKey,
  normalizePayee,
  payoutDetailsFor,
  periodStart,
  shiftPeriod,
  summarizePayouts,
  toCents,
} from "../src/lib/admin/payouts-math.ts";

/**
 * A payout run is money sent to teenagers by hand from a phone. The page has to
 * agree with the note it replaced to the cent, and has to open on the month
 * that is actually being paid.
 */

test("the default run is the month that just ended, in Ljubljana", () => {
  // 2 October: September is being paid.
  assert.equal(defaultPayoutPeriod(new Date("2026-10-02T10:00:00Z")), "2026-09");
  // 23:30 UTC on 30 September is already 1 October in Ljubljana.
  assert.equal(defaultPayoutPeriod(new Date("2026-09-30T23:30:00Z")), "2026-09");
  assert.equal(defaultPayoutPeriod(new Date("2026-09-30T20:00:00Z")), "2026-08");
  // January pays December of the year before.
  assert.equal(defaultPayoutPeriod(new Date("2027-01-05T10:00:00Z")), "2026-12");
});

test("months shift across year ends and store as the first of the month", () => {
  assert.equal(shiftPeriod("2026-12", 1), "2027-01");
  assert.equal(shiftPeriod("2026-01", -1), "2025-12");
  assert.equal(shiftPeriod("2026-09", -13), "2025-08");
  assert.equal(periodStart("2026-09"), "2026-09-01");
  assert.equal(formatPeriod("2026-09"), "September 2026");
});

test("only real months are accepted from the URL", () => {
  assert.ok(isPeriodKey("2026-09"));
  assert.ok(!isPeriodKey("2026-13"));
  assert.ok(!isPeriodKey("2026-9"));
  assert.ok(!isPeriodKey("2026-09-01"));
  assert.ok(!isPeriodKey(undefined));
});

test("amounts read the way the numeric column and the form hand them over", () => {
  assert.equal(toCents("6.50"), 650);
  assert.equal(toCents("6,50"), 650);
  assert.equal(toCents(187), 18700);
  assert.equal(toCents(""), 0);
  assert.equal(toCents(null), 0);
  assert.ok(Number.isNaN(toCents("abc")));
});

test("the September 2026 run adds up to what was agreed", () => {
  const lines = [
    { base_amount: "261.00", bonus_amount: "187.00", paid_at: null }, // Pija
    { base_amount: "80.00", bonus_amount: "13.00", paid_at: null }, // Neli
    { base_amount: "50.00", bonus_amount: "13.00", paid_at: null }, // Ema
    { base_amount: "10.00", bonus_amount: "43.00", paid_at: null }, // Zala
    { base_amount: "0.00", bonus_amount: "41.00", paid_at: null }, // Maja
    { base_amount: "35.00", bonus_amount: "0.00", paid_at: null }, // Špela
    { base_amount: "15.00", bonus_amount: "15.00", paid_at: null }, // Ana
    { base_amount: "16.00", bonus_amount: "13.00", paid_at: null }, // David
    { base_amount: "2.00", bonus_amount: "0.00", paid_at: null }, // Martin
    { base_amount: "0.00", bonus_amount: "6.50", paid_at: null }, // Mija
    { base_amount: "0.00", bonus_amount: "6.50", paid_at: null }, // Megi
    { base_amount: "10.00", bonus_amount: "0.00", paid_at: null }, // Ema Kozelj
  ];

  const summary = summarizePayouts(lines);

  assert.equal(summary.total, 81700);
  assert.equal(summary.base, 47900);
  assert.equal(summary.bonus, 33800);
  assert.equal(summary.owed, 81700);
  assert.equal(summary.paid, 0);
  assert.equal(summary.lines, 12);
});

test("a paid line moves from owed to paid and nothing else changes", () => {
  const summary = summarizePayouts([
    { base_amount: "10", bonus_amount: "43", paid_at: "2026-10-02T12:00:00Z" },
    { base_amount: "0", bonus_amount: "6.5", paid_at: null },
  ]);

  assert.equal(summary.total, 5950);
  assert.equal(summary.paid, 5300);
  assert.equal(summary.owed, 650);
  assert.equal(summary.paidLines, 1);
});

test("a payee typed two ways lands on the same line", () => {
  assert.equal(normalizePayee("  david "), "David");
  assert.equal(normalizePayee("Mija  in   Megi"), "Mija in Megi");
  assert.equal(normalizePayee("špela"), "Špela");
  assert.equal(normalizePayee("   "), "");
});

test("status lines show whole euros plainly and halves exactly", () => {
  assert.equal(formatEuros(81700), "€817");
  assert.equal(formatEuros(650), "€6.50");
});

test("each half of a pair sees only their own payment details", () => {
  const details = "David: Flik 040 111 222\nMartin: Flik 031 333 444";

  assert.equal(payoutDetailsFor(details, "David"), "David: Flik 040 111 222");
  assert.equal(payoutDetailsFor(details, "martin"), "Martin: Flik 031 333 444");
  // No payee, or a payee the details do not name: show everything.
  assert.equal(payoutDetailsFor(details, ""), details);
  assert.equal(payoutDetailsFor("Flik 070 000 000", "Mija"), "Flik 070 000 000");
  assert.equal(payoutDetailsFor(null, "David"), null);
});
