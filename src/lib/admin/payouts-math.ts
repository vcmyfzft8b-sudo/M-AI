/**
 * Creator payout runs: which month a payout belongs to, and what is still owed.
 *
 * Pure, so the page, the server actions and the tests agree on every rule.
 * Amounts are stored as euros in `numeric` columns (which the client hands
 * back as strings) and summed here in cents, so a run of €6.50 halves cannot
 * drift by a cent.
 */

import { todayInReportZone } from "./ranges.ts";

/** A month, as "YYYY-MM". */
export type PeriodKey = string;

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isPeriodKey(value: string | null | undefined): value is PeriodKey {
  return typeof value === "string" && PERIOD_PATTERN.test(value);
}

/** "2026-09" → "2026-09-01", the value the `period` column holds. */
export function periodStart(key: PeriodKey): string {
  return `${key}-01`;
}

/** "2026-09-01" (or any day in it) → "2026-09". */
export function periodOf(day: string): PeriodKey {
  return day.slice(0, 7);
}

export function shiftPeriod(key: PeriodKey, months: number): PeriodKey {
  const [year, month] = key.split("-").map(Number);
  const index = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;

  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

/**
 * The month a payout run is normally for: the one that just ended.
 *
 * Creators are paid once a month for the month before, so on 2 October the
 * run being prepared is September's, not the two days of October so far.
 */
export function defaultPayoutPeriod(now: Date = new Date()): PeriodKey {
  return shiftPeriod(periodOf(todayInReportZone(now)), -1);
}

export function formatPeriod(key: PeriodKey): string {
  const [year, month] = key.split("-").map(Number);

  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Euros from a form field or a `numeric` column, as whole cents. */
export function toCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const amount = typeof value === "number" ? value : Number(String(value).replace(",", "."));

  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
}

export type PayoutAmounts = {
  base_amount: number | string;
  bonus_amount: number | string;
  paid_at: string | null;
};

export function payoutTotalCents(payout: PayoutAmounts): number {
  return toCents(payout.base_amount) + toCents(payout.bonus_amount);
}

export type PayoutSummary = {
  /** Everything in the run, cents. */
  total: number;
  base: number;
  bonus: number;
  /** Already sent, cents. */
  paid: number;
  /** Still to send, cents. */
  owed: number;
  lines: number;
  paidLines: number;
};

export function summarizePayouts(payouts: PayoutAmounts[]): PayoutSummary {
  const summary: PayoutSummary = {
    total: 0,
    base: 0,
    bonus: 0,
    paid: 0,
    owed: 0,
    lines: payouts.length,
    paidLines: 0,
  };

  for (const payout of payouts) {
    const base = toCents(payout.base_amount);
    const bonus = toCents(payout.bonus_amount);

    summary.base += base;
    summary.bonus += bonus;
    summary.total += base + bonus;

    if (payout.paid_at) {
      summary.paid += base + bonus;
      summary.paidLines += 1;
    } else {
      summary.owed += base + bonus;
    }
  }

  return summary;
}
