import { PAYWALL_REASONS, type PaywallReason } from "./paywall-reasons.ts";

/**
 * The offer gets better every time a paywall finds the learner, and never
 * worse.
 *
 * Before anything, the paywall is the plain price with the free trial. Each
 * paywall moment after that moves the learner one rung up: a feature limit
 * (the chat, the read-aloud, a second note, the same limit again later) or a
 * browsing offer (`paywall-nudge.tsx`). The first moment offers 20 % off the
 * first payment, the second 30 %, the third and every one after 40 %. Nothing
 * ever shows a lower rung than one already reached, and the daily wheel's 50 %
 * stays the best price there is, so nothing here may go past it.
 *
 * The moments live in a cookie the server writes (`POST
 * /api/billing/paywall-view`), kept only while they still lift the price.
 * A paywall shows the rung its own moment will reach before it is recorded,
 * then the server's answer. Checkout gives the rung the paywall showed, but
 * never more than the cookie allows. Every discount covers the first payment
 * only and comes without a trial or a promo code.
 *
 * Web only for now: the app sells through Apple, whose prices come from App
 * Store Connect, so it always shows the first step.
 */
export type PaywallOffer = {
  /** 1 is the plain price with the trial; 2, 3 and 4 are the discounts. */
  step: number;
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

export const PAYWALL_SEEN_COOKIE = "memo-paywall-seen";
export const PAYWALL_SEEN_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const LAST_STEP = PAYWALL_LADDER.length;

/** The paywall moments recorded so far, oldest first; only as many as still lift the price. */
export function readSeenReasons(value: unknown): PaywallReason[] {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    return [];
  }

  return value
    .split(".")
    .filter((part): part is PaywallReason => (PAYWALL_REASONS as readonly string[]).includes(part))
    .slice(0, LAST_STEP - 1);
}

export function writeSeenReasons(seen: readonly PaywallReason[]) {
  return seen.join(".");
}

/** Adds a paywall moment, while there is still a rung above to climb to. */
export function recordSeenReason(seen: readonly PaywallReason[], reason: PaywallReason): PaywallReason[] {
  return seen.length < LAST_STEP - 1 ? [...seen, reason] : [...seen];
}

/** The offer on a step; anything out of range is clamped onto the ladder. */
export function paywallOffer(step: number): PaywallOffer {
  const index = Math.min(Math.max(Math.trunc(step) || 1, 1), LAST_STEP) - 1;
  return PAYWALL_LADDER[index];
}

/** The best rung the recorded moments have reached: the plain price before any. */
export function reachedOffer(seen: readonly PaywallReason[]): PaywallOffer {
  return paywallOffer(seen.length + 1);
}

/**
 * The offer a paywall shows before its moment is recorded. A paywall opened by
 * a limit or a browsing offer is a new moment, so it shows the rung above the
 * one reached; one opened by nothing (the Upgrade button) shows the rung
 * reached, the plain price included.
 */
export function paywallOfferFor(reason: PaywallReason | null, seen: readonly PaywallReason[]): PaywallOffer {
  return reason ? reachedOffer(recordSeenReason(seen, reason)) : reachedOffer(seen);
}

/**
 * What checkout charges: the rung the paywall showed, never above the rung
 * the recorded moments allow. The paywall records its moment before it lets
 * the buyer through, so the two agree.
 */
export function checkoutOffer(requestedStep: number | null | undefined, seen: readonly PaywallReason[]): PaywallOffer {
  const allowed = reachedOffer(seen);
  return requestedStep ? paywallOffer(Math.min(requestedStep, allowed.step)) : allowed;
}

/** A price with the step's discount taken off, rounded to the cent. */
export function discountedAmount(amount: number, percentOff: number) {
  return Math.round(amount * (100 - percentOff)) / 100;
}

/**
 * A year's price as a weekly one, rounded down to the cent so it is never
 * advertised above what is charged (the wheel's sheet does the same).
 */
export function weeklyAmount(yearlyAmount: number) {
  return Math.floor((yearlyAmount / 52) * 100) / 100;
}
