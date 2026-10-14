/*
 * What a plan costs, by the buyer's country.
 *
 * Memo charges one euro price everywhere except the Balkan countries below,
 * where Astra AI, the competitor learners there compare us with, sells for a
 * fraction of its Slovenian price (App Store, 14 Oct 2026: Plus monthly
 * €24 SI, €21 HR, €17 ME, $19 MK, €13 BA, €11 RS). Serbia's price is the
 * owner's own number; the others follow Astra's spread between those
 * countries. Every price is still charged in EUR — Stripe has no dinar,
 * mark or denar price on this account, and Astra charges euros there too.
 *
 * The country is Vercel's `x-vercel-ip-country`, which Vercel's edge sets and
 * the browser cannot. It is read on the server only; nothing the client sends
 * may pick a price. The iOS app buys through Apple and never sees these.
 *
 * Each regional price is its own Stripe Price, found by its lookup key
 * (`memo_<plan>_<country>`, see `scripts/setup-regional-prices.mjs`), so
 * adding a country needs no new environment variable.
 */

export type RegionalPlan = "monthly" | "yearly";
export type PlanPrices = Record<RegionalPlan, number>;

export const STANDARD_PLAN_PRICES: PlanPrices = { monthly: 20, yearly: 130 };

export const REGIONAL_PLAN_PRICES: Readonly<Record<string, PlanPrices>> = {
  RS: { monthly: 10, yearly: 50 },
  BA: { monthly: 12, yearly: 60 },
  ME: { monthly: 15, yearly: 80 },
  MK: { monthly: 15, yearly: 80 },
  HR: { monthly: 18, yearly: 100 },
};

/** The country whose regional prices apply, or `null` for the standard price. */
export function pricingRegion(country: string | null | undefined): string | null {
  const code = country?.trim().toUpperCase();

  return code && Object.hasOwn(REGIONAL_PLAN_PRICES, code) ? code : null;
}

export function planPricesFor(country: string | null | undefined): PlanPrices {
  const region = pricingRegion(country);

  return region ? REGIONAL_PLAN_PRICES[region] : STANDARD_PLAN_PRICES;
}

export function regionalPriceLookupKey(plan: RegionalPlan, region: string) {
  return `memo_${plan}_${region.toLowerCase()}`;
}

/**
 * A yearly price spread over twelve months, rounded down to the cent: €130 is
 * €10.83 a month, not €11. Rounding up would advertise the plan above what is
 * actually charged, the one direction a price must never be wrong in.
 */
export function monthlyShareOfYearly(yearly: number) {
  return Math.floor((yearly / 12) * 100) / 100;
}
