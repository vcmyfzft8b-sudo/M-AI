/**
 * Sales arithmetic.
 *
 * Kept free of `server-only` and of the Stripe SDK so the revenue, MRR, trial
 * conversion and promo-code attribution rules can be unit tested directly:
 * `sales.ts` fetches, this file decides what the numbers mean.
 */

// Relative rather than the `@/` alias: this module is imported directly by the
// unit tests, which run under plain Node and cannot resolve the alias.
import {
  addDays,
  type DateRange,
  eachDay,
  todayInReportZone,
} from "./ranges.ts";

/** Mirrors Stripe's subscription statuses without importing the SDK here. */
export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

export type SubscriptionSnapshot = {
  id: string;
  customerId: string | null;
  status: SubscriptionStatus;
  plan: string | null;
  currency: string;
  unitAmount: number;
  created: number;
  trialStart: number | null;
  trialEnd: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: number | null;
  promotionCodeId: string | null;
};

export type PaymentSnapshot = {
  id: string;
  created: number;
  /** Minor units (cents). */
  amount: number;
  currency: string;
  customerId: string | null;
  promotionCodeIds: string[];
};

export type SalesData = {
  subscriptions: SubscriptionSnapshot[];
  payments: PaymentSnapshot[];
  promotionCodes: Map<string, string>;
  /** True when a page cap was hit and the figures are therefore partial. */
  truncated: boolean;
};

const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
]);

export type TrialProjection = {
  /** Trials that have not yet ended. */
  activeTrials: number;
  /** Trials whose `trial_end` falls inside the selected window. */
  trialsEndingInRange: number;
  /** Trials ending today, in the reporting timezone. */
  trialsEndingToday: number;
  /** Fraction of finished trials that produced a paid invoice. */
  conversionRate: number;
  /** Finished trials the rate was computed from. */
  conversionSampleSize: number;
  /** Mean minor-unit value of a converting subscription. */
  averageConvertedValue: number;
  /** trialsEndingToday x conversionRate x averageConvertedValue, minor units. */
  projectedRevenueToday: number;
  /** Same projection across every trial ending in the window. */
  projectedRevenueInRange: number;
  currency: string;
};

export type SalesSummary = {
  /** Paid revenue inside the window, minor units. */
  revenue: number;
  /** Paid revenue in the equally long window before it, minor units. */
  previousRevenue: number;
  /** Committed monthly recurring revenue from live subscriptions, minor units. */
  mrr: number;
  activeSubscriptions: number;
  payingSubscriptions: number;
  newSubscriptionsInRange: number;
  canceledInRange: number;
  currency: string;
  trials: TrialProjection;
  truncated: boolean;
};

/** Normalises a subscription's amount to a monthly figure for MRR. */
function monthlyValue(subscription: SubscriptionSnapshot): number {
  switch (subscription.plan) {
    case "weekly":
      return (subscription.unitAmount * 52) / 12;
    case "yearly":
      return subscription.unitAmount / 12;
    case "monthly":
      return subscription.unitAmount;
    default:
      return subscription.unitAmount;
  }
}

function unixDay(unix: number): string {
  return todayInReportZone(new Date(unix * 1000));
}

export function summarizeSales(data: SalesData, range: DateRange): SalesSummary {
  const today = todayInReportZone();
  const nowUnix = Math.floor(Date.now() / 1000);

  const inRange = (unix: number | null) => {
    if (unix === null) {
      return false;
    }

    const day = unixDay(unix);
    return day >= range.from && day <= range.to;
  };

  const revenue = data.payments
    .filter((payment) => inRange(payment.created))
    .reduce((sum, payment) => sum + payment.amount, 0);

  const previousRevenue = range.previous
    ? data.payments
        .filter((payment) => {
          const day = unixDay(payment.created);
          return day >= range.previous!.from && day <= range.previous!.to;
        })
        .reduce((sum, payment) => sum + payment.amount, 0)
    : 0;

  const live = data.subscriptions.filter((subscription) =>
    ACTIVE_STATUSES.has(subscription.status),
  );
  const paying = live.filter((subscription) => subscription.status !== "trialing");

  const mrr = paying.reduce(
    (sum, subscription) => sum + monthlyValue(subscription),
    0,
  );

  const currency = live[0]?.currency ?? data.payments[0]?.currency ?? "eur";

  // Conversion is measured over trials that have already finished: a trial
  // still running has not had the chance to convert and would drag the rate
  // down if counted.
  const finishedTrials = data.subscriptions.filter(
    (subscription) =>
      subscription.trialEnd !== null && subscription.trialEnd <= nowUnix,
  );

  const payingCustomerIds = new Set(
    data.payments
      .filter((payment) => payment.customerId)
      .map((payment) => payment.customerId as string),
  );

  const convertedTrials = finishedTrials.filter(
    (subscription) =>
      subscription.customerId && payingCustomerIds.has(subscription.customerId),
  );

  const conversionRate =
    finishedTrials.length > 0 ? convertedTrials.length / finishedTrials.length : 0;

  const averageConvertedValue =
    convertedTrials.length > 0
      ? convertedTrials.reduce(
          (sum, subscription) => sum + subscription.unitAmount,
          0,
        ) / convertedTrials.length
      : 0;

  const activeTrials = data.subscriptions.filter(
    (subscription) =>
      subscription.status === "trialing" &&
      subscription.trialEnd !== null &&
      subscription.trialEnd > nowUnix,
  );

  const trialsEndingToday = activeTrials.filter(
    (subscription) => unixDay(subscription.trialEnd as number) === today,
  ).length;

  const trialsEndingInRange = activeTrials.filter((subscription) =>
    inRange(subscription.trialEnd),
  ).length;

  return {
    revenue,
    previousRevenue,
    mrr,
    activeSubscriptions: live.length,
    payingSubscriptions: paying.length,
    newSubscriptionsInRange: data.subscriptions.filter((subscription) =>
      inRange(subscription.created),
    ).length,
    canceledInRange: data.subscriptions.filter((subscription) =>
      inRange(subscription.canceledAt),
    ).length,
    currency,
    truncated: data.truncated,
    trials: {
      activeTrials: activeTrials.length,
      trialsEndingInRange,
      trialsEndingToday,
      conversionRate,
      conversionSampleSize: finishedTrials.length,
      averageConvertedValue,
      projectedRevenueToday: Math.round(
        trialsEndingToday * conversionRate * averageConvertedValue,
      ),
      projectedRevenueInRange: Math.round(
        trialsEndingInRange * conversionRate * averageConvertedValue,
      ),
      currency,
    },
  };
}

export type RevenueDay = {
  day: string;
  revenue: number;
  newSubscriptions: number;
  trialsStarted: number;
};

export function revenueSeries(data: SalesData, range: DateRange): RevenueDay[] {
  const byDay = new Map<string, RevenueDay>();

  for (const day of eachDay(range.from, range.to)) {
    byDay.set(day, { day, revenue: 0, newSubscriptions: 0, trialsStarted: 0 });
  }

  for (const payment of data.payments) {
    const entry = byDay.get(unixDay(payment.created));

    if (entry) {
      entry.revenue += payment.amount;
    }
  }

  for (const subscription of data.subscriptions) {
    const entry = byDay.get(unixDay(subscription.created));

    if (entry) {
      entry.newSubscriptions += 1;

      if (subscription.trialStart !== null) {
        entry.trialsStarted += 1;
      }
    }
  }

  return Array.from(byDay.values());
}

export type ForecastDay = {
  day: string;
  /** Trials whose trial_end falls on this day. */
  trialsEnding: number;
  /** trialsEnding x conversionRate x averageConvertedValue, in minor units. */
  projectedRevenue: number;
};

/**
 * Expected revenue per day from trials that are due to end.
 *
 * Recomputed from Stripe on every load, so it moves as trials start and end and
 * as the measured conversion rate changes: the same trial pipeline against a
 * better conversion rate forecasts more money, with no other input.
 */
export function trialForecast(
  data: SalesData,
  options: { days?: number; now?: Date } = {},
): { days: ForecastDay[]; conversionRate: number; averageValue: number } {
  const horizon = options.days ?? 14;
  const now = options.now ?? new Date();
  const nowUnix = Math.floor(now.getTime() / 1000);
  const today = todayInReportZone(now);

  const finishedTrials = data.subscriptions.filter(
    (subscription) =>
      subscription.trialEnd !== null && subscription.trialEnd <= nowUnix,
  );

  const payingCustomerIds = new Set(
    data.payments
      .filter((payment) => payment.customerId)
      .map((payment) => payment.customerId as string),
  );

  const convertedTrials = finishedTrials.filter(
    (subscription) =>
      subscription.customerId && payingCustomerIds.has(subscription.customerId),
  );

  const conversionRate =
    finishedTrials.length > 0 ? convertedTrials.length / finishedTrials.length : 0;

  const averageValue =
    convertedTrials.length > 0
      ? convertedTrials.reduce(
          (sum, subscription) => sum + subscription.unitAmount,
          0,
        ) / convertedTrials.length
      : 0;

  const byDay = new Map<string, ForecastDay>();

  for (let offset = 0; offset < horizon; offset += 1) {
    const day = addDays(today, offset);
    byDay.set(day, { day, trialsEnding: 0, projectedRevenue: 0 });
  }

  for (const subscription of data.subscriptions) {
    if (
      subscription.status !== "trialing" ||
      subscription.trialEnd === null ||
      subscription.trialEnd <= nowUnix
    ) {
      continue;
    }

    const entry = byDay.get(
      todayInReportZone(new Date(subscription.trialEnd * 1000)),
    );

    if (entry) {
      entry.trialsEnding += 1;
    }
  }

  for (const entry of byDay.values()) {
    entry.projectedRevenue = Math.round(
      entry.trialsEnding * conversionRate * averageValue,
    );
  }

  return { days: Array.from(byDay.values()), conversionRate, averageValue };
}

export type PromoCodeStats = {
  code: string;
  /** Paid revenue attributed to the code inside the window, minor units. */
  revenue: number;
  /** Paid invoices carrying the code inside the window. */
  payments: number;
  /** Subscriptions ever created with the code. */
  subscriptions: number;
  /** Distinct customers who paid with the code inside the window. */
  customers: number;
};

/**
 * Attributes revenue to promotion codes.
 *
 * This is what links a creator to money: each creator owns codes like `EMA50`,
 * and every paid invoice carrying that discount is revenue they drove.
 */
export function promoCodeStats(
  data: SalesData,
  range: DateRange,
): Map<string, PromoCodeStats> {
  const stats = new Map<string, PromoCodeStats>();

  const ensure = (code: string) => {
    const key = code.toUpperCase();
    let entry = stats.get(key);

    if (!entry) {
      entry = { code: key, revenue: 0, payments: 0, subscriptions: 0, customers: 0 };
      stats.set(key, entry);
    }

    return entry;
  };

  const customersByCode = new Map<string, Set<string>>();

  for (const payment of data.payments) {
    const day = unixDay(payment.created);

    if (day < range.from || day > range.to) {
      continue;
    }

    for (const promotionCodeId of payment.promotionCodeIds) {
      const code = data.promotionCodes.get(promotionCodeId);

      if (!code) {
        continue;
      }

      const entry = ensure(code);
      entry.revenue += payment.amount;
      entry.payments += 1;

      if (payment.customerId) {
        const key = code.toUpperCase();
        const set = customersByCode.get(key) ?? new Set<string>();
        set.add(payment.customerId);
        customersByCode.set(key, set);
      }
    }
  }

  for (const subscription of data.subscriptions) {
    if (!subscription.promotionCodeId) {
      continue;
    }

    const code = data.promotionCodes.get(subscription.promotionCodeId);

    if (code) {
      ensure(code).subscriptions += 1;
    }
  }

  for (const [code, customers] of customersByCode) {
    const entry = stats.get(code);

    if (entry) {
      entry.customers = customers.size;
    }
  }

  return stats;
}

/** Rolls promo-code stats up to the creator that owns the codes. */
export function creatorRevenue(
  creators: Array<{ id: string; promo_codes: string[] }>,
  stats: Map<string, PromoCodeStats>,
): Map<string, { revenue: number; payments: number; customers: number }> {
  const byCreator = new Map<
    string,
    { revenue: number; payments: number; customers: number }
  >();

  for (const creator of creators) {
    const entry = { revenue: 0, payments: 0, customers: 0 };

    for (const code of creator.promo_codes ?? []) {
      const codeStats = stats.get(code.toUpperCase());

      if (codeStats) {
        entry.revenue += codeStats.revenue;
        entry.payments += codeStats.payments;
        entry.customers += codeStats.customers;
      }
    }

    byCreator.set(creator.id, entry);
  }

  return byCreator;
}

export function formatMoney(minorUnits: number, currency = "eur"): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
  }).format(minorUnits / 100);
}
