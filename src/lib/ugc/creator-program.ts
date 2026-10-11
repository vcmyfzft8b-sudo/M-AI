/**
 * The UGC creator program's public terms: what the page at `/ugc` promises, and the
 * arithmetic behind its earnings calculator and tier cards.
 *
 * Pay differs by market, so everything here is keyed by one:
 *
 * - `si` — Slovenia: a flat fee per video plus a share of what the creator's own
 *   discount code sells.
 * - `balkans` — Croatia, Bosnia and Herzegovina, Serbia, Montenegro, North Macedonia:
 *   a higher flat fee per video plus a view bonus (per 1,000 views), capped per month.
 *
 * The figures themselves are in `creator-campaigns.ts`, which only the server reads: the
 * page is handed its own campaign's terms, so neither the HTML nor the JavaScript of one
 * campaign's page contains the other's pay. Everything here works on the terms it is
 * given. Nothing here is read by payouts — those are agreed per creator in the admin.
 *
 * Pure on purpose (no `server-only`, relative imports), so the client page and the
 * Node tests both load it.
 */

export const CREATOR_MARKETS = ["si", "balkans"] as const;

export type CreatorMarket = (typeof CREATOR_MARKETS)[number];

export type CreatorTerms = {
  /** Euros for every video posted to the brief on TikTok. */
  perTikTok: number;
  /** Euros more when the same video is also posted on Instagram Reels. */
  perInstagram: number;
  /** Share of the cash the creator's code collects, in percent. 0 when not offered. */
  codeSharePercent: number;
  /** Euros per 1,000 views. 0 when not offered. */
  viewRatePer1k: number;
  /** Most the view bonus pays in a month, in euros. Null when uncapped. */
  viewBonusCap: number | null;
};

/** The most one video can earn in flat fees: posted on TikTok and on Instagram. */
export function perVideoTotal(terms: CreatorTerms): number {
  return terms.perTikTok + terms.perInstagram;
}

/** How many videos a month earn the per-video fees (Terms 3.4). The calculator stops at it. */
export const PAID_VIDEOS_PER_MONTH = 60;

/**
 * The code bonus is a share of sales, not of views, so the calculator has to guess the
 * sales a month of views brings. These two numbers are that guess, and the page says so
 * under the figure.
 *
 * Every creator code gives 50% off the first period, so a sale collects €10 (monthly)
 * or €65 (yearly) and 20% of that is €2 or €13. €6.50 assumes roughly two monthly
 * sales for every yearly one; one sale per 10,000 views is the optimistic end of what
 * the campaign has seen.
 */
export const CODE_SALES_PER_1K_VIEWS = 0.1;
export const AVERAGE_CODE_SALE_CASH = 32.5;

/** The campaign so far, for the stats band. Kept by hand: the source is not this database. */
export const CREATOR_PROGRAM_STATS = {
  views: 50_000_000,
  videos: 1_000,
  creators: 100,
};

/** Countries the program recruits in, in the order the form lists them. */
export const APPLICATION_COUNTRIES = ["SI", "HR", "BA", "RS", "ME", "MK"] as const;

/**
 * Each campaign's own countries. The two campaigns are run as separate programs: a
 * visitor is shown one of them, decided on the server from their IP country, and never
 * sees the other's page, pay or terms.
 */
export const MARKET_COUNTRIES: Record<CreatorMarket, ReadonlyArray<(typeof APPLICATION_COUNTRIES)[number]>> = {
  si: ["SI"],
  balkans: ["HR", "BA", "RS", "ME", "MK"],
};

/** Stored for anyone outside the list ("ZZ" is ISO 3166's user-assigned "unknown"). */
export const OTHER_COUNTRY = "ZZ";

export type ApplicationCountry = (typeof APPLICATION_COUNTRIES)[number] | typeof OTHER_COUNTRY;

const BALKAN_COUNTRIES = new Set(["HR", "BA", "RS", "ME", "MK"]);

/** Which terms a country is on; `null` for a country the program does not recruit in. */
export function marketForCountry(country: string | null | undefined): CreatorMarket | null {
  const code = country?.trim().toUpperCase();

  if (code === "SI") {
    return "si";
  }

  return code && BALKAN_COUNTRIES.has(code) ? "balkans" : null;
}

/**
 * The campaign a visitor is shown: their IP country when it is one of ours, otherwise the
 * language they read the page in (a Croatian, Bosnian or Serbian reader abroad is a
 * Balkan creator; anyone else gets Slovenia). There is no switch on the page.
 */
export function defaultMarket(country: string | null | undefined, locale: string): CreatorMarket {
  return marketForCountry(country) ?? (locale === "hr" || locale === "bs" || locale === "sr" ? "balkans" : "si");
}

export type EarningsEstimate = {
  tiktokPay: number;
  instagramPay: number;
  videoPay: number;
  bonus: number;
  total: number;
  /** The view bonus hit its monthly cap. */
  capped: boolean;
};

/**
 * A month's pay for so many videos and so many views, in whole euros. Assumes every
 * video goes out on both TikTok and Instagram, and never counts past the monthly cap.
 */
export function estimateEarnings(terms: CreatorTerms, videos: number, views: number): EarningsEstimate {
  const thousands = Math.max(0, views) / 1000;
  const paidVideos = Math.min(PAID_VIDEOS_PER_MONTH, Math.max(0, Math.round(videos)));
  const tiktokPay = paidVideos * terms.perTikTok;
  const instagramPay = paidVideos * terms.perInstagram;
  const videoPay = tiktokPay + instagramPay;

  const codeBonus = thousands * CODE_SALES_PER_1K_VIEWS * AVERAGE_CODE_SALE_CASH * (terms.codeSharePercent / 100);
  const viewBonus = thousands * terms.viewRatePer1k;
  const cap = terms.viewBonusCap ?? Number.POSITIVE_INFINITY;
  const capped = viewBonus > cap;
  const bonus = Math.round(codeBonus + Math.min(viewBonus, cap));

  return { tiktokPay, instagramPay, videoPay, bonus, total: videoPay + bonus, capped };
}

export const CREATOR_TIERS = [
  { key: "beginner", videos: 20, views: [50_000, 150_000] },
  { key: "experienced", videos: 40, views: [300_000, 800_000] },
  { key: "ultra", videos: PAID_VIDEOS_PER_MONTH, views: [2_000_000, null] },
] as const;

export type CreatorTierKey = (typeof CREATOR_TIERS)[number]["key"];

export type TierRange = {
  key: CreatorTierKey;
  videos: number;
  low: number;
  /** Null for the open-ended top tier, shown as "€X+". */
  high: number | null;
};

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

/** Each tier's monthly range, from the same arithmetic as the calculator. */
export function tierRanges(terms: CreatorTerms): TierRange[] {
  return CREATOR_TIERS.map((tier) => {
    const [fewest, most] = tier.views;
    const low = estimateEarnings(terms, tier.videos, fewest).total;

    return {
      key: tier.key,
      videos: tier.videos,
      // The open-ended tier floors to a round hundred so "€3,000+" never overstates.
      low: most === null ? Math.floor(low / 100) * 100 : roundTo(low, 50),
      high: most === null ? null : roundTo(estimateEarnings(terms, tier.videos, most).total, 50),
    };
  });
}

/** The calculator's view slider: a stepped scale, because views span three orders of magnitude. */
export const VIEW_STEPS = [
  10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 750_000, 1_000_000, 1_500_000, 2_000_000, 3_000_000,
  5_000_000,
] as const;

export const VIDEO_RANGE = { min: 5, max: PAID_VIDEOS_PER_MONTH, step: 5, initial: 30 } as const;

export const INITIAL_VIEW_STEP = VIEW_STEPS.indexOf(500_000);
