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
 * Instagram Reels for a little more. Slovenia: €5 + €1. Balkans: €7 + €5. The bonus on
 * top (Slovenia: 20% of code sales; Balkans: €1 per 1,000 views) is capped at €2,000 a
 * month in both.
 */
export const CREATOR_TERMS: Record<CreatorMarket, CreatorTerms> = {
  si: { perTikTok: 5, perInstagram: 1, codeSharePercent: 20, viewRatePer1k: 0, bonusCap: 2000 },
  balkans: { perTikTok: 7, perInstagram: 5, codeSharePercent: 0, viewRatePer1k: 1, bonusCap: 2000 },
};

/**
 * Where an accepted creator goes next: each campaign has its own Discord, handed over by
 * the join page once the Terms of Participation are accepted.
 * Permanent invites (checked 2026-10-11: no expiry, no use limit).
 */
export const CREATOR_DISCORD_INVITES: Record<CreatorMarket, string> = {
  si: "https://discord.gg/4mae76zNhj",
  balkans: "https://discord.gg/Dur6dfF2qD",
};
