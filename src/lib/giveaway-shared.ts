/**
 * The back-to-school giveaway, the parts both the browser and the server
 * need: the campaign's constants, the shape of a code, and the pure rules the
 * screens render from. Everything that touches Stripe or the database is in
 * `giveaway.ts`, which is server-only.
 */

/** The campaign every code and referral is filed under. */
export const GIVEAWAY_CAMPAIGN = "back_to_school_2026";

/** How many paying friends win the prize. */
export const GIVEAWAY_GOAL = 20;

/** What a friend's code takes off their first billing period. */
export const GIVEAWAY_DISCOUNT_PERCENT = 50;

/**
 * The Stripe coupon every giveaway code points at — 50 % off, applied once.
 * It already exists in the account and is the same coupon the creator codes
 * and the prize wheel use, so a giveaway sale looks like any other discounted
 * sale in Stripe.
 */
export const GIVEAWAY_COUPON_ID = "memo50-first-cycle";

/** How many rows the leaderboard shows. */
export const GIVEAWAY_LEADERBOARD_SIZE = 10;

/**
 * The cookie a friend's code rides in from the share link to checkout. Read
 * by the landing page (to say the discount is waiting), the paywall (to show
 * it) and the checkout route (to apply it).
 */
export const GIVEAWAY_REF_COOKIE = "memo-giveaway-ref";

/** Thirty days: a friend who clicks today and subscribes next month still counts. */
export const GIVEAWAY_REF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** How often an open leaderboard asks for fresh standings. */
export const GIVEAWAY_POLL_MS = 30_000;

/**
 * Codes look like `BTS-7K2XQ4`: a fixed prefix so a friend recognises what
 * it is, then six characters from an alphabet without 0/O/1/I, which are
 * indistinguishable when read off a phone screen. Stripe allows letters,
 * digits and dashes, and matches codes case-insensitively.
 */
export const GIVEAWAY_CODE_PREFIX = "BTS";
export const GIVEAWAY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const GIVEAWAY_CODE_RANDOM_LENGTH = 6;

const CODE_PATTERN = new RegExp(
  `^${GIVEAWAY_CODE_PREFIX}-[${GIVEAWAY_CODE_ALPHABET}]{${GIVEAWAY_CODE_RANDOM_LENGTH}}$`,
);

/** Upper-cases and trims whatever a URL or a form carried. */
export function normalizeGiveawayCode(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

/** True for a string shaped like one of our codes. Says nothing about whether it exists. */
export function isGiveawayCodeFormat(value: string | null | undefined) {
  return CODE_PATTERN.test(normalizeGiveawayCode(value));
}

/** Builds a code from six draws of the alphabet, supplied by the caller. */
export function formatGiveawayCode(draws: ArrayLike<number>) {
  let random = "";

  for (let index = 0; index < GIVEAWAY_CODE_RANDOM_LENGTH; index += 1) {
    random += GIVEAWAY_CODE_ALPHABET[draws[index] % GIVEAWAY_CODE_ALPHABET.length];
  }

  return `${GIVEAWAY_CODE_PREFIX}-${random}`;
}

/** The link a learner shares. `/r/<code>` sets the cookie and lands on the site. */
export function buildGiveawayShareUrl(origin: string, code: string) {
  return `${origin.replace(/\/$/, "")}/r/${encodeURIComponent(normalizeGiveawayCode(code))}`;
}

export type GiveawayLeaderboardEntry = {
  /** Masked: "Ana K." or "an***", never an address. */
  name: string;
  qualifiedCount: number;
  /** When this account's goal-th referral qualified, if it has. */
  reachedGoalAt: string | null;
  /** True for the row belonging to the signed-in viewer. */
  isViewer?: boolean;
};

export type GiveawayLeaderboard = {
  campaign: string;
  goal: number;
  entries: GiveawayLeaderboardEntry[];
  /** The winner, once somebody has reached the goal. */
  winner: GiveawayLeaderboardEntry | null;
  updatedAt: string;
};

/**
 * What the leaderboard shows as a name.
 *
 * The board is public — it sits on the landing page — so it never carries an
 * email address or a full surname. A first name and an initial is enough for
 * friends to spot each other; an account without a name gets the first two
 * letters of its address and nothing else.
 */
export function maskGiveawayName(
  fullName: string | null | undefined,
  email: string | null | undefined,
  fallback: string,
) {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);

  if (parts.length > 0) {
    const first = parts[0];
    const last = parts.length > 1 ? parts[parts.length - 1] : "";

    return last ? `${first} ${last[0].toUpperCase()}.` : first;
  }

  const local = (email ?? "").split("@")[0].trim();

  if (local.length >= 2) {
    return `${local.slice(0, 2).toLowerCase()}***`;
  }

  return fallback;
}

/**
 * The winner is the first row, if it has reached the goal: the SQL orders by
 * the time the goal was reached before anything else, so nobody with a
 * bigger count can sit above the account that got there first.
 */
export function findGiveawayWinner(entries: GiveawayLeaderboardEntry[]) {
  const first = entries[0];

  return first && first.reachedGoalAt ? first : null;
}
