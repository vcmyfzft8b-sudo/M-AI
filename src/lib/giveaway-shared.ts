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

/** What the winner gets, as it is named on every screen. */
export const GIVEAWAY_PRIZE_NAME = "iPhone 18 Pro";

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
export const GIVEAWAY_LEADERBOARD_SIZE = 12;

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

/**
 * One or two letters for the podium avatar, from the masked name: "Zala K."
 * gives "ZK", "ma***" gives "M". Stars are the mask, not a name.
 */
export function giveawayInitials(name: string) {
  const words = name
    .replace(/[*.]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

/**
 * A row as it is ranked, before it is sent: the real rows carry the time
 * their count was last raised, which decides ties.
 */
export type GiveawayRankedEntry = GiveawayLeaderboardEntry & {
  latestQualifiedAt: string | null;
};

/**
 * The board's opening field.
 *
 * A leaderboard that starts empty says nobody is playing. These names are
 * made up, hold the first places until real accounts pass them, and are
 * never written anywhere: they are merged into the ranking on the way out,
 * below every real account with the same count (their tie-break time is
 * the end of the year), and none of them can reach the goal, so a real
 * account that does wins outright.
 */
export const GIVEAWAY_SEED_ENTRIES: ReadonlyArray<{ name: string; qualifiedCount: number }> = [
  { name: "Žiga K.", qualifiedCount: 7 },
  { name: "Nika P.", qualifiedCount: 6 },
  { name: "Tjaša M.", qualifiedCount: 5 },
  { name: "Luka B.", qualifiedCount: 5 },
  { name: "Maja Z.", qualifiedCount: 4 },
  { name: "Jan H.", qualifiedCount: 3 },
  { name: "Eva R.", qualifiedCount: 3 },
  { name: "Nejc S.", qualifiedCount: 2 },
  { name: "Ana K.", qualifiedCount: 2 },
  { name: "Matic V.", qualifiedCount: 1 },
  { name: "Sara L.", qualifiedCount: 1 },
];

/** Later than any real referral this campaign can produce: seeds lose every tie. */
const SEED_TIE_TIME = "2026-12-31T23:59:59.000Z";

/**
 * The campaign's ordering rule, the same one the SQL function applies to
 * real rows: whoever reached the goal first, then the count, then whoever
 * reached their count first. Pure, so the seeds can be merged with real
 * rows on the way out and the rule can be tested.
 */
export function rankGiveawayEntries(
  entries: ReadonlyArray<GiveawayRankedEntry>,
  limit = GIVEAWAY_LEADERBOARD_SIZE,
): GiveawayLeaderboardEntry[] {
  const time = (value: string | null) => (value ? Date.parse(value) : Number.POSITIVE_INFINITY);

  return [...entries]
    .sort((a, b) => {
      const goalA = time(a.reachedGoalAt);
      const goalB = time(b.reachedGoalAt);

      if (goalA !== goalB) {
        return goalA - goalB;
      }

      if (a.qualifiedCount !== b.qualifiedCount) {
        return b.qualifiedCount - a.qualifiedCount;
      }

      return time(a.latestQualifiedAt) - time(b.latestQualifiedAt);
    })
    .slice(0, limit)
    .map((entry) => {
      const sent: GiveawayLeaderboardEntry = {
        name: entry.name,
        qualifiedCount: entry.qualifiedCount,
        reachedGoalAt: entry.reachedGoalAt,
      };

      return entry.isViewer ? { ...sent, isViewer: true } : sent;
    });
}

/** The seeds, shaped for ranking. */
export function giveawaySeedEntries(): GiveawayRankedEntry[] {
  return GIVEAWAY_SEED_ENTRIES.map((seed) => ({
    name: seed.name,
    qualifiedCount: seed.qualifiedCount,
    reachedGoalAt: null,
    latestQualifiedAt: SEED_TIE_TIME,
  }));
}
