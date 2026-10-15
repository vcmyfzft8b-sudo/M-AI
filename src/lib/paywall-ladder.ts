/**
 * The offer gets better each time a learner meets the paywall without buying.
 *
 * The first paywall is the plain price with the free trial. Every later one is
 * a step down the ladder: 20 %, then 30 %, then 40 % off the first billing
 * period. The daily wheel's 50 % stays the best price there is, so nothing here
 * may go past it.
 *
 * Where the learner is on the ladder lives in a cookie the server sets. It can
 * only move one step per paywall shown, and checkout never applies more than
 * the cookie allows, so a link cannot ask for a better price than the learner
 * has been shown. Reaching the last step needs nothing but opening the paywall
 * a few times, which is why the last step stays under the wheel.
 *
 * Web only for now: the app sells through Apple, whose prices come from App
 * Store Connect, so it always shows step 1.
 *
 * Pure: the page, the checkout route and the tests all use it.
 */
export type PaywallOffer = {
  step: number;
  /** 0 for the first step, which sells the trial instead. */
  percentOff: number;
  /** Stripe coupon, `duration: once`; null on the first step. */
  coupon: string | null;
};

export const PAYWALL_LADDER: readonly PaywallOffer[] = [
  { step: 1, percentOff: 0, coupon: null },
  { step: 2, percentOff: 20, coupon: "memo20-first-cycle" },
  { step: 3, percentOff: 30, coupon: "memo30-first-cycle" },
  { step: 4, percentOff: 40, coupon: "memo40-first-cycle" },
];

export const PAYWALL_STEP_COOKIE = "memo-paywall-step";
export const PAYWALL_STEP_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const LAST_STEP = PAYWALL_LADDER.length;

/** The step stored in the cookie: 0 before any paywall has been shown. */
export function readPaywallStep(value: unknown): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : typeof value === "number" ? value : 0;
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 0), LAST_STEP) : 0;
}

/** The step the next paywall shows, given the step already reached. */
export function nextPaywallStep(reached: number) {
  return Math.min(readPaywallStep(reached) + 1, LAST_STEP);
}

/**
 * What to store after a paywall reports it was shown at `shown`: never more
 * than one step past what was already reached, never backwards.
 */
export function advancePaywallStep(reached: number, shown: number) {
  const current = readPaywallStep(reached);
  return Math.max(current, Math.min(readPaywallStep(shown), current + 1));
}

/** The offer for a step; anything out of range is clamped onto the ladder. */
export function paywallOffer(step: number): PaywallOffer {
  const index = Math.min(Math.max(Math.trunc(step) || 1, 1), LAST_STEP) - 1;
  return PAYWALL_LADDER[index];
}

/**
 * The offer checkout may apply: the one the client says it showed, but never
 * past the step the cookie has reached.
 */
export function checkoutPaywallOffer(claimedStep: unknown, reached: number): PaywallOffer {
  const claimed = typeof claimedStep === "number" ? claimedStep : 1;
  return paywallOffer(Math.min(claimed, Math.max(readPaywallStep(reached), 1)));
}

/** A price with the step's discount taken off, rounded to the cent. */
export function discountedAmount(amount: number, percentOff: number) {
  return Math.round(amount * (100 - percentOff)) / 100;
}
