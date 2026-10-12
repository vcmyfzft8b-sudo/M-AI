import type { CreatorMarket, CreatorTerms } from "./creator-program.ts";

/**
 * Each campaign's pay and Discord. Server only, on purpose.
 *
 * The Slovenian and Balkan campaigns are separate programs, and a visitor must not be
 * able to find the other one's pay, nor reach a Discord without accepting the terms. So
 * nothing that runs in the browser imports this module: the page is handed its own
 * campaign's `CreatorTerms` as a prop, and an invite leaves the server only from the join
 * route, once the terms are accepted. `tests/ugc-creator-program.test.mjs` fails if a
 * client component imports it. (It carries no `server-only` marker so that the Node tests
 * can load it.)
 */

/**
 * One video is paid per platform it goes out on: TikTok, then the same video on
 * Instagram Reels on top. Slovenia: €5 + €1. Balkans: €4 + €3. The bonus on top
 * (Slovenia: 20% of code sales; Balkans: €0.50 per 1,000 views) is capped at €2,000 a
 * month in both.
 */
export const CREATOR_TERMS: Record<CreatorMarket, CreatorTerms> = {
  si: { perTikTok: 5, perInstagram: 1, codeSharePercent: 20, viewRatePer1k: 0, bonusCap: 2000 },
  balkans: { perTikTok: 4, perInstagram: 3, codeSharePercent: 0, viewRatePer1k: 0.5, bonusCap: 2000 },
};

/**
 * Campaign pay that has since changed, each with the last terms version that carried it.
 * An applicant who accepted the campaign terms agreed to the campaign's pay of that
 * version, and the admin must show them that rather than today's. Add an entry here
 * whenever `CREATOR_TERMS` changes (and bump `CREATOR_TERMS_VERSION` with it).
 */
const EARLIER_CREATOR_TERMS: ReadonlyArray<{ market: CreatorMarket; throughVersion: string; terms: CreatorTerms }> = [
  {
    market: "balkans",
    throughVersion: "2026-10-12.1",
    terms: { perTikTok: 7, perInstagram: 5, codeSharePercent: 0, viewRatePer1k: 1, bonusCap: 2000 },
  },
];

/** Orders terms versions ("2026-10-12.2"): by date, then by the number after the dot. */
function compareTermsVersions(a: string, b: string): number {
  const [dateA, countA = "0"] = a.split(".");
  const [dateB, countB = "0"] = b.split(".");

  return dateA === dateB ? Number(countA) - Number(countB) : dateA.localeCompare(dateB);
}

/** The campaign pay a creator agreed to by accepting `version` of the terms; today's when unknown. */
export function campaignTermsAt(market: CreatorMarket, version: string | null): CreatorTerms {
  const earlier = version
    ? EARLIER_CREATOR_TERMS.filter(
        (entry) => entry.market === market && compareTermsVersions(version, entry.throughVersion) <= 0,
      ).sort((a, b) => compareTermsVersions(a.throughVersion, b.throughVersion))[0]
    : undefined;

  return earlier?.terms ?? CREATOR_TERMS[market];
}

/**
 * Where an accepted creator goes next: each campaign has its own Discord, handed over by
 * the join page once the Terms of Participation are accepted.
 * Permanent invites (checked 2026-10-11: no expiry, no use limit).
 */
export const CREATOR_DISCORD_INVITES: Record<CreatorMarket, string> = {
  si: "https://discord.gg/4mae76zNhj",
  balkans: "https://discord.gg/Dur6dfF2qD",
};

/**
 * Each campaign's own link. Two pages, never one switching between them: a visitor whose
 * IP belongs to the other campaign is redirected to their own (`creator-market.server.ts`).
 */
export const CREATOR_CAMPAIGN_PATHS: Record<CreatorMarket, string> = {
  si: "/ugc/slovenija",
  balkans: "/ugc/balkan",
};

/** Each campaign's Terms of Participation, under its own page. */
export const CREATOR_TERMS_PATHS: Record<CreatorMarket, string> = {
  si: "/ugc/slovenija/pogoji",
  balkans: "/ugc/balkan/uvjeti",
};
