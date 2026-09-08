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

/**
 * Slack on the Soniox keys over the slice they are for.
 *
 * The keys must outlive the slice by enough to finish the sentence in progress and report
 * back, or the last turn of every slice would be cut off mid-word.
 *
 * Lives here, beside the allowance itself, because both halves of the session need it: the
 * server mints the keys for the slice plus this, and the client has to subtract exactly the
 * same number to find the end of the talking time it was given. When only the server knew
 * it, the client guessed with the renewal margin instead and came due before the slice had
 * started.
 */
export const TUTOR_GRANT_KEY_GRACE_SECONDS = 45;

/**
 * The two things that spend spoken time, and the fact that they no longer spend the same
 * allowance.
 *
 * They shared one for as long as the podcast was new, and it was the wrong shape: an evening
 * of episodes silently took the tutor away, and the meter could not say which had gone. Each
 * now has its own day and its own free minute. What is NOT split is the hour somebody buys —
 * that is bought as voice time and spends on either, because a top-up you can spend in the
 * wrong place is a support ticket rather than a feature.
 */
export type VoiceFeature = "tutor" | "podcast";

/**
 * The podcast's day, deliberately the same size as the tutor's.
 *
 * Not because the two cost the same to run — they cost exactly the same, a minute of Soniox
 * either way — but because a smaller number here would have to be explained, and there is
 * nothing to explain. The exposure is worth naming: a subscriber who empties both every day
 * costs about $21 a month in synthesis against €10.83 on the yearly plan. Nobody uses a cap
 * daily; the cap is what the plan promises, so it is what the promise is worth.
 */
export const PAID_PODCAST_DAILY_SECONDS = 30 * 60;

/** A minute of the podcast, once, for the same reason the tutor gets one. */
export const FREE_PODCAST_LIFETIME_SECONDS = 60;

export function dailySecondsFor(feature: VoiceFeature) {
  return feature === "podcast" ? PAID_PODCAST_DAILY_SECONDS : PAID_TUTOR_DAILY_SECONDS;
}

export function freeLifetimeSecondsFor(feature: VoiceFeature) {
  return feature === "podcast" ? FREE_PODCAST_LIFETIME_SECONDS : FREE_TUTOR_LIFETIME_SECONDS;
}

/** One purchase, in seconds. Priced per hour, so an hour is what a purchase is. */
export const TUTOR_CREDIT_PACK_SECONDS = 60 * 60;

export type TutorAllowanceInput = {
  /** Which of the two allowances this is. They are counted, and run out, separately. */
  feature: VoiceFeature;
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
  feature: VoiceFeature;
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
      feature: input.feature,
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
    const freeLimit = freeLifetimeSecondsFor(input.feature);

    return {
      feature: input.feature,
      remainingSeconds: Math.max(freeLimit - spent, 0),
      limitSeconds: freeLimit,
      usedSeconds: Math.min(spent, freeLimit),
      creditSeconds: 0,
      hasPaidAccess: false,
      hasUnlimitedUsage: false,
      source: "free",
    };
  }

  const dailyLimit = dailySecondsFor(input.feature);
  const dailySpent = input.dailySeconds + input.reservedSeconds;
  const dailyRemaining = Math.max(dailyLimit - dailySpent, 0);

  return {
    feature: input.feature,
    remainingSeconds: dailyRemaining + input.creditSeconds,
    limitSeconds: dailyLimit,
    usedSeconds: Math.min(dailySpent, dailyLimit),
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
