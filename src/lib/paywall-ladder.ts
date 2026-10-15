import { PAYWALL_REASONS, type PaywallReason } from "./paywall-reasons.ts";

/**
 * The offer gets better with each feature limit a learner runs into.
 *
 * Before any limit, the paywall is the plain price with the free trial. The
 * first feature that runs out — whichever it is: the chat, the read-aloud, a
 * second note — offers 20 % off the first payment; the second feature to run
 * out offers 30 %; the third and every one after, 40 %. The daily wheel's 50 %
 * stays the best price there is, so nothing here may go past it.
 *
 * The discount belongs to the feature. Each one keeps the rung it was given
 * the first time, so coming back to the chat paywall later shows the chat's
 * 20 % again, not whatever the latest limit earned. Paywalls opened without a
 * feature (the Upgrade button, Settings) show the best rung reached so far.
 *
 * The order the limits were met in lives in a cookie the server writes
 * (`POST /api/billing/paywall-view`), and checkout reads the price from that
 * cookie, never from the request alone. Reaching the last rung needs nothing
 * but hitting three limits, which is why the last rung stays under the wheel.
 *
 * A learner who has not run into anything yet still climbs: while they browse,
 * an offer finds them now and then (`paywall-nudge.tsx`), and each one moves
 * them up a rung, exactly as a feature limit would. It is recorded as `offer`,
 * the one entry that may appear more than once, and only while it still lifts
 * the price; at the top rung the offer keeps showing the 40 % it reached.
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

/** The features whose limits the learner has met, in the order they met them. */
export function readSeenReasons(value: unknown): PaywallReason[] {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    return [];
  }

  const seen: PaywallReason[] = [];

  for (const part of value.split(".")) {
    if (!(PAYWALL_REASONS as readonly string[]).includes(part)) {
      continue;
    }

    const reason = part as PaywallReason;

    if (reason === "offer" ? seen.length < LAST_STEP - 1 : !seen.includes(reason)) {
      seen.push(reason);
    }
  }

  return seen;
}

export function writeSeenReasons(seen: readonly PaywallReason[]) {
  return seen.join(".");
}

/**
 * Adds a feature the first time its limit is met; never reorders. An offer is
 * added every time it is shown, but only while it still lifts the price — once
 * the learner is on the top rung it changes nothing.
 */
export function recordSeenReason(seen: readonly PaywallReason[], reason: PaywallReason): PaywallReason[] {
  if (reason === "offer") {
    return seen.length < LAST_STEP - 1 ? [...seen, reason] : [...seen];
  }

  return seen.includes(reason) ? [...seen] : [...seen, reason];
}

/** The offer on a step; anything out of range is clamped onto the ladder. */
export function paywallOffer(step: number): PaywallOffer {
  const index = Math.min(Math.max(Math.trunc(step) || 1, 1), LAST_STEP) - 1;
  return PAYWALL_LADDER[index];
}

/**
 * The offer a paywall shows. A feature's own rung is its place in the order
 * the limits were met — or the next place, the first time. No feature, or an
 * offer (recorded before it is shown): the best rung reached, or the plain
 * price before any.
 */
export function paywallOfferFor(reason: PaywallReason | null, seen: readonly PaywallReason[]): PaywallOffer {
  if (!reason || reason === "offer") {
    return paywallOffer(seen.length === 0 ? 1 : seen.length + 1);
  }

  const place = seen.indexOf(reason);
  return paywallOffer((place >= 0 ? place : seen.length) + 2);
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
