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
  /** Lifetime redemption count per code, keyed by the uppercased code. */
  codeRedemptions: Map<string, number>;
  /** True when a page cap was hit and the figures are therefore partial. */
  truncated: boolean;
};

const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
]);

export type PlanConversionRates = {
  /** Rate per plan id, only where the sample was large enough to trust. */
  byPlan: Map<string, { rate: number; sample: number }>;
  /** Fallback for plans with too little history of their own. */
  overall: number;
  overallSample: number;
};

/** Below this many finished trials, a plan's own rate is too noisy to use. */
const MIN_PLAN_SAMPLE = 20;

/**
 * Conversion rate per plan.
 *
 * A yearly trial and a monthly trial do not convert at the same rate, and they
 * are worth very different amounts, so blending them into one average and one
 * mean price gives a number that matches no actual customer. Plans with too
 * little history of their own fall back to the overall rate.
 */
export function conversionRatesByPlan(
  data: SalesData,
  now: Date = new Date(),
): PlanConversionRates {
  const nowUnix = Math.floor(now.getTime() / 1000);

  const payingCustomerIds = new Set(
    data.payments
      .filter((payment) => payment.customerId)
      .map((payment) => payment.customerId as string),
  );

  const finished = data.subscriptions.filter(
    (subscription) =>
      subscription.trialEnd !== null && subscription.trialEnd <= nowUnix,
  );

  const tally = new Map<string, { finished: number; converted: number }>();

  for (const subscription of finished) {
    const plan = subscription.plan ?? "unknown";
    const entry = tally.get(plan) ?? { finished: 0, converted: 0 };
    entry.finished += 1;

    if (subscription.customerId && payingCustomerIds.has(subscription.customerId)) {
      entry.converted += 1;
    }

    tally.set(plan, entry);
  }

  const totalConverted = Array.from(tally.values()).reduce(
    (sum, entry) => sum + entry.converted,
    0,
  );
  const overall = finished.length > 0 ? totalConverted / finished.length : 0;

  const byPlan = new Map<string, { rate: number; sample: number }>();

  for (const [plan, entry] of tally) {
    if (entry.finished >= MIN_PLAN_SAMPLE) {
      byPlan.set(plan, { rate: entry.converted / entry.finished, sample: entry.finished });
    }
  }

  return { byPlan, overall, overallSample: finished.length };
}

export function rateFor(plan: string | null, rates: PlanConversionRates): number {
  return rates.byPlan.get(plan ?? "unknown")?.rate ?? rates.overall;
}

/**
 * Expected revenue from a set of trials, in minor units.
 *
 * Each trial is valued at its own subscription price times the conversion rate
 * for its own plan, and the results are summed — rather than counting the
 * trials and multiplying by one blended average price.
 */
export function projectTrials(
  trials: SubscriptionSnapshot[],
  rates: PlanConversionRates,
): number {
  return Math.round(
    trials.reduce(
      (sum, subscription) =>
        sum + subscription.unitAmount * rateFor(subscription.plan, rates),
      0,
    ),
  );
}

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
  /** Conversion rate per plan, and the sample each was measured over. */
  ratesByPlan: PlanConversionRates;
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

export function summarizeSales(
  data: SalesData,
  range: DateRange,
  // Injectable so the arithmetic can be tested against fixed fixtures: dating a
  // trial "today at 16:00" otherwise flips from pending to finished as the real
  // clock passes it, and the test starts failing on its own.
  options: { now?: Date } = {},
): SalesSummary {
  const now = options.now ?? new Date();
  const today = todayInReportZone(now);
  const nowUnix = Math.floor(now.getTime() / 1000);

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

  const converted = (subscription: SubscriptionSnapshot) =>
    Boolean(subscription.customerId && payingCustomerIds.has(subscription.customerId));

  const convertedTrials = finishedTrials.filter(converted);

  const conversionRate =
    finishedTrials.length > 0 ? convertedTrials.length / finishedTrials.length : 0;

  const rates = conversionRatesByPlan(data, now);

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

  const endingToday = activeTrials.filter(
    (subscription) => unixDay(subscription.trialEnd as number) === today,
  );

  const endingInRange = activeTrials.filter((subscription) =>
    inRange(subscription.trialEnd),
  );

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
      trialsEndingInRange: endingInRange.length,
      trialsEndingToday: endingToday.length,
      conversionRate,
      conversionSampleSize: finishedTrials.length,
      averageConvertedValue,
      ratesByPlan: rates,
      projectedRevenueToday: projectTrials(endingToday, rates),
      projectedRevenueInRange: projectTrials(endingInRange, rates),
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
): {
  days: ForecastDay[];
  rates: PlanConversionRates;
  /** Plans represented in the upcoming trials, with what each is worth. */
  planBreakdown: Array<{
    plan: string;
    trials: number;
    unitAmount: number;
    rate: number;
    projected: number;
  }>;
} {
  const horizon = options.days ?? 14;
  const now = options.now ?? new Date();
  const nowUnix = Math.floor(now.getTime() / 1000);
  const today = todayInReportZone(now);

  const rates = conversionRatesByPlan(data, now);

  const byDay = new Map<string, { day: string; trials: SubscriptionSnapshot[] }>();

  for (let offset = 0; offset < horizon; offset += 1) {
    byDay.set(addDays(today, offset), { day: addDays(today, offset), trials: [] });
  }

  const upcoming: SubscriptionSnapshot[] = [];

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
      entry.trials.push(subscription);
      upcoming.push(subscription);
    }
  }

  const planTally = new Map<
    string,
    { plan: string; trials: number; total: number }
  >();

  for (const subscription of upcoming) {
    const plan = subscription.plan ?? "unknown";
    const entry = planTally.get(plan) ?? { plan, trials: 0, total: 0 };
    entry.trials += 1;
    entry.total += subscription.unitAmount;
    planTally.set(plan, entry);
  }

  return {
    days: Array.from(byDay.values()).map((entry) => ({
      day: entry.day,
      trialsEnding: entry.trials.length,
      projectedRevenue: projectTrials(entry.trials, rates),
    })),
    rates,
    planBreakdown: Array.from(planTally.values())
      .map((entry) => ({
        plan: entry.plan,
        trials: entry.trials,
        // Mean price of the trials on this plan, which is exact when a plan has
        // one price and still meaningful when it has several.
        unitAmount: Math.round(entry.total / entry.trials),
        rate: rateFor(entry.plan, rates),
        projected: Math.round(entry.total * rateFor(entry.plan, rates)),
      }))
      .sort((a, b) => b.projected - a.projected),
  };
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

/**
 * Rolls promo-code usage up to the creator that owns the codes.
 *
 * This measures *tracked* signups, not earnings. Most people who see a video
 * and subscribe never type the code, so `revenue` here is a floor and is
 * deliberately not what the dashboard reports as a creator's revenue — see
 * `campaign-value.ts` for that.
 */
export function creatorRevenue(
  creators: Array<{ id: string; promo_codes: string[] }>,
  stats: Map<string, PromoCodeStats>,
  redemptions?: Map<string, number>,
): Map<
  string,
  { revenue: number; payments: number; customers: number; redemptions: number }
> {
  const byCreator = new Map<
    string,
    { revenue: number; payments: number; customers: number; redemptions: number }
  >();

  for (const creator of creators) {
    const entry = { revenue: 0, payments: 0, customers: 0, redemptions: 0 };

    for (const code of creator.promo_codes ?? []) {
      const key = code.toUpperCase();
      const codeStats = stats.get(key);

      if (codeStats) {
        entry.revenue += codeStats.revenue;
        entry.payments += codeStats.payments;
        entry.customers += codeStats.customers;
      }

      entry.redemptions += redemptions?.get(key) ?? 0;
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
