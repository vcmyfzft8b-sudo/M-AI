/**
 * The running-costs table: what a month has cost so far, and where it is
 * heading.
 *
 * Pure, so the page and the tests agree. Everything is summed in euro cents;
 * providers that bill in dollars are converted at one rate per page load.
 *
 * Three kinds of line, because they behave differently mid-month:
 * - **metered** — read from the provider (Stripe, OpenRouter, Soniox, Vercel
 *   when a billing token exists) or from our own call log. Projected to the
 *   end of the month at the pace so far.
 * - **fixed** — a subscription entered by hand (Supabase, Apple, a domain).
 *   Counted in full for the month, so the projection is not fooled by the
 *   date.
 * - **payouts** — the creator run recorded on the Payouts page for that month.
 *   Paid in arrears, so a month's figure only appears once the run is entered.
 */

import { addDays, dayStartIso, todayInReportZone } from "./ranges.ts";
import { periodOf, type PeriodKey } from "./payouts-math.ts";

export type CostKind = "metered" | "estimate" | "fixed" | "payouts";

export type CostLine = {
  key: string;
  label: string;
  kind: CostKind;
  /** Cents spent in the month so far; null when the source could not answer. */
  soFar: number | null;
  /** Cents the month is heading for; null when it cannot be projected. */
  projected: number | null;
  /** Where the number came from, or why there is none. */
  note: string;
};

export type MonthWindow = {
  period: PeriodKey;
  /** First day, "YYYY-MM-DD". */
  from: string;
  /** Last day, "YYYY-MM-DD". */
  to: string;
  fromIso: string;
  /** Exclusive upper bound: midnight starting the next month. */
  toIso: string;
  /**
   * The same month in UTC, for providers that only meter whole UTC days
   * (Soniox, Vercel): asking them from Ljubljana's midnight pulls in all of
   * the previous day.
   */
  utcFromIso: string;
  utcToIso: string;
  isCurrent: boolean;
  /** Share of the month already behind us, 0–1. 1 for a past month. */
  elapsed: number;
};

function lastDayOf(period: PeriodKey): string {
  const [year, month] = period.split("-").map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return `${period}-${String(day).padStart(2, "0")}`;
}

/** A calendar month in Europe/Ljubljana, and how much of it has passed. */
export function monthWindow(period: PeriodKey, now: Date = new Date()): MonthWindow {
  const from = `${period}-01`;
  const to = lastDayOf(period);
  const fromIso = dayStartIso(from);
  const toIso = dayStartIso(addDays(to, 1));
  const isCurrent = periodOf(todayInReportZone(now)) === period;

  const start = Date.parse(fromIso);
  const end = Date.parse(toIso);
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));

  const utcFromIso = `${from}T00:00:00.000Z`;
  const utcToIso = `${addDays(to, 1)}T00:00:00.000Z`;

  return { period, from, to, fromIso, toIso, utcFromIso, utcToIso, isCurrent, elapsed };
}

/** Dollars to euro cents at `eurPerUsd`. */
export function usdToEurCents(usd: number, eurPerUsd: number): number {
  return Math.round(usd * eurPerUsd * 100);
}

export type FixedCost = {
  amount: number | string;
  currency: string;
  cadence: "monthly" | "yearly";
};

/** What a fixed cost comes to for one month, in euro cents. */
export function fixedMonthlyCents(cost: FixedCost, eurPerUsd: number): number {
  const amount = Number(cost.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  const monthly = cost.cadence === "yearly" ? amount / 12 : amount;

  return cost.currency.toLowerCase() === "usd"
    ? usdToEurCents(monthly, eurPerUsd)
    : Math.round(monthly * 100);
}

/**
 * Where a metered cost is heading by the end of the month, at the pace so far.
 *
 * Before 3% of the month has passed (the first day) the pace is noise, so no
 * projection is offered rather than multiplying one morning by thirty.
 */
export function projectMetered(
  soFar: number | null,
  window: MonthWindow,
  /**
   * The share of the month this reading actually covers, when it is not the
   * Ljubljana month up to now — a provider read over the UTC month up to the
   * last full hour has seen less of it, and dividing by the larger share
   * would project it low.
   */
  covered: number = window.elapsed,
): number | null {
  if (soFar === null) {
    return null;
  }

  if (!window.isCurrent) {
    return soFar;
  }

  if (covered < 0.03) {
    return null;
  }

  return Math.round(soFar / Math.min(1, covered));
}

/** The share of `[fromIso, toIso)` that lies before `untilIso`, 0–1. */
export function shareBefore(fromIso: string, toIso: string, untilIso: string): number {
  const from = Date.parse(fromIso);
  const span = Date.parse(toIso) - from;

  return Math.min(1, Math.max(0, (Date.parse(untilIso) - from) / span));
}

export type CostTotals = {
  soFar: number;
  /** Null while it is too early in the month to say. */
  projected: number | null;
  /** Lines whose source did not answer, so the totals are a floor. */
  missing: number;
};

export function totalCosts(lines: CostLine[]): CostTotals {
  let soFar = 0;
  let projected: number | null = 0;
  let missing = 0;

  for (const line of lines) {
    if (line.soFar === null) {
      missing += 1;
    } else {
      soFar += line.soFar;
    }

    // A line that has a reading but no projection yet (the first hours of a
    // month) leaves the month's direction unknown: adding its so-far figure
    // would pass a morning off as a month.
    if (line.soFar !== null && line.projected === null) {
      projected = null;
    } else if (projected !== null) {
      projected += line.projected ?? 0;
    }
  }

  return { soFar, projected, missing };
}

export type StripeBalanceRow = {
  type: string;
  amount: number;
  fee: number;
};

export type StripeMonth = {
  /** Card payments in, cents. */
  gross: number;
  /** Money handed back, cents (positive). */
  refunds: number;
  /** Processing fees on payments plus Stripe's own Billing charges, cents. */
  fees: number;
};

/**
 * Stripe's money for a month from its balance transactions.
 *
 * Processing fees ride on each payment as `fee`; Stripe Billing's usage fee
 * arrives as its own `stripe_fee` transaction with a negative amount. Both
 * are costs, so both are counted.
 */
export function summarizeStripeBalance(rows: StripeBalanceRow[]): StripeMonth {
  const month: StripeMonth = { gross: 0, refunds: 0, fees: 0 };

  for (const row of rows) {
    month.fees += row.fee ?? 0;

    switch (row.type) {
      case "charge":
      case "payment":
        month.gross += row.amount;
        break;
      case "refund":
      case "payment_refund":
        month.refunds -= row.amount;
        break;
      case "stripe_fee":
        month.fees -= row.amount;
        break;
    }
  }

  return month;
}
