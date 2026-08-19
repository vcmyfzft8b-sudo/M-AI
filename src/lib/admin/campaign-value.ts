/**
 * What a view is worth.
 *
 * Attributing revenue by discount code undercounts badly: most people who see a
 * creator's video and subscribe never type the code, so code-attributed revenue
 * is a floor, not a measure. Counting codes is still worth doing — it says who
 * is driving *tracked* signups — but it is the wrong basis for "what did this
 * creator earn us".
 *
 * Instead the campaign is valued as a whole: total revenue over a baseline
 * window divided by total campaign views over that same window gives a revenue
 * per thousand views. A creator's share is then their views at that rate, and a
 * day's views can be projected forward at it.
 *
 * The rate gets better on its own as the window fills with more days.
 */

/** Days of history the rate is measured over. */
export const VALUE_BASELINE_DAYS = 30;

/**
 * Below this many views the rate is too noisy to publish — a handful of views
 * against a month of revenue produces an absurd figure.
 */
export const MIN_VIEWS_FOR_RATE = 1_000;

export type ViewValue = {
  /** Revenue per 1000 views, in minor units. Null when there is too little data. */
  revenuePerMille: number | null;
  /** Minor units of revenue the rate was derived from. */
  revenue: number;
  /** Campaign views the rate was derived from. */
  views: number;
  /** Days of history behind the rate. */
  days: number;
  /** True once there is enough data for the rate to mean anything. */
  reliable: boolean;
};

export function computeViewValue(input: {
  revenue: number;
  views: number;
  days: number;
}): ViewValue {
  const reliable = input.views >= MIN_VIEWS_FOR_RATE && input.revenue > 0;

  return {
    revenuePerMille: reliable ? (input.revenue / input.views) * 1000 : null,
    revenue: input.revenue,
    views: input.views,
    days: input.days,
    reliable,
  };
}

/** Revenue those views are worth at the measured rate, in minor units. */
export function estimateRevenue(views: number, value: ViewValue): number | null {
  if (value.revenuePerMille === null) {
    return null;
  }

  return Math.round((views / 1000) * value.revenuePerMille);
}

/**
 * How many views are needed to earn a given amount, at the measured rate.
 * Useful for a target, and for sanity-checking the rate itself.
 */
export function viewsForRevenue(
  minorUnits: number,
  value: ViewValue,
): number | null {
  if (!value.revenuePerMille) {
    return null;
  }

  return Math.round((minorUnits / value.revenuePerMille) * 1000);
}

export type CreatorCodeUsage = {
  /** Distinct customers who paid using one of this creator's codes. */
  customers: number;
  /** Paid invoices carrying one of their codes. */
  payments: number;
  /** Lifetime redemptions of their codes, from Stripe. */
  redemptions: number;
};
