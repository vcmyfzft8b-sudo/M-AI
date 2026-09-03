// The rules about how much talking time somebody has, separated from the tables they are
// read out of. Kept free of "@/" imports and of `server-only` so the unit tests can load it:
// this is where the arithmetic that decides whether a learner is charged actually lives, and
// it is far cheaper to assert on numbers than to reproduce a quota in a browser.

/**
 * What a free account gets: one minute, once, ever.
 *
 * Not a daily allowance. A minute is enough to hear what the thing is and not enough to
 * study from, which is exactly what a trial should be — and a minute a day would be an
 * annoyance rather than an offer.
 */
export const FREE_TUTOR_LIFETIME_SECONDS = 60;

/** What a subscription includes each day, before anything has to be bought. */
export const PAID_TUTOR_DAILY_SECONDS = 30 * 60;

/** One purchase, in seconds. Priced per hour, so an hour is what a purchase is. */
export const TUTOR_CREDIT_PACK_SECONDS = 60 * 60;

export type TutorAllowanceInput = {
  hasPaidAccess: boolean;
  hasUnlimitedUsage: boolean;
  /** Every second ever spent, for the free lifetime cap. */
  lifetimeSeconds: number;
  /** Seconds spent today, for the paid daily cap. */
  dailySeconds: number;
  /** Bought and not yet spent. */
  creditSeconds: number;
  /** Handed out to a session that has not reported back yet. Spent until proven otherwise. */
  reservedSeconds: number;
};

export type TutorAllowance = {
  remainingSeconds: number;
  limitSeconds: number;
  usedSeconds: number;
  creditSeconds: number;
  hasPaidAccess: boolean;
  hasUnlimitedUsage: boolean;
  source: "free" | "daily" | "credit";
};

/**
 * How much is left, and which pot the next second comes out of.
 *
 * Reserved time counts as spent. Without that, two tabs are both told the whole allowance is
 * free and both are right until the first one finishes — and a session that is never reported
 * would be free forever.
 *
 * Credits are spent last on purpose: somebody paying monthly should get the half hour their
 * subscription includes before the hour they topped up with, or topping up would quietly
 * throw away what they had already paid for.
 */
export function computeTutorAllowance(input: TutorAllowanceInput): TutorAllowance {
  if (input.hasUnlimitedUsage) {
    return {
      remainingSeconds: Number.MAX_SAFE_INTEGER,
      limitSeconds: Number.MAX_SAFE_INTEGER,
      usedSeconds: 0,
      creditSeconds: 0,
      hasPaidAccess: true,
      hasUnlimitedUsage: true,
      source: "daily",
    };
  }

  if (!input.hasPaidAccess) {
    // Credits are not offered to a free account: the thing to buy first is the plan, not an
    // hour of one feature inside it. Any it somehow holds are kept, not spent.
    const spent = input.lifetimeSeconds + input.reservedSeconds;

    return {
      remainingSeconds: Math.max(FREE_TUTOR_LIFETIME_SECONDS - spent, 0),
      limitSeconds: FREE_TUTOR_LIFETIME_SECONDS,
      usedSeconds: Math.min(spent, FREE_TUTOR_LIFETIME_SECONDS),
      creditSeconds: 0,
      hasPaidAccess: false,
      hasUnlimitedUsage: false,
      source: "free",
    };
  }

  const dailySpent = input.dailySeconds + input.reservedSeconds;
  const dailyRemaining = Math.max(PAID_TUTOR_DAILY_SECONDS - dailySpent, 0);

  return {
    remainingSeconds: dailyRemaining + input.creditSeconds,
    limitSeconds: PAID_TUTOR_DAILY_SECONDS,
    usedSeconds: Math.min(dailySpent, PAID_TUTOR_DAILY_SECONDS),
    creditSeconds: input.creditSeconds,
    hasPaidAccess: true,
    hasUnlimitedUsage: false,
    source: dailyRemaining > 0 ? "daily" : "credit",
  };
}

/** What a settled slice actually costs: never more than was reserved, never negative. */
export function chargeableSeconds(reportedSeconds: number, grantedSeconds: number) {
  if (!Number.isFinite(reportedSeconds)) {
    return grantedSeconds;
  }

  return Math.max(0, Math.min(Math.round(reportedSeconds), grantedSeconds));
}
