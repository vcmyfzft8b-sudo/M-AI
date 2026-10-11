import { formatCurrency } from "../utils.ts";
import type { Locale } from "../i18n/locales.ts";
import { CREATOR_TERMS } from "./creator-campaigns.ts";
import { PAID_VIDEOS_PER_MONTH, perVideoTotal, type CreatorMarket } from "./creator-program.ts";
import { CREATOR_TERMS_TEXT } from "./creator-terms-text.ts";

/**
 * The creator program's Terms of Participation, as a creator reads and accepts them.
 *
 * Bump the version whenever the meaning of any clause changes (the text is in
 * `creator-terms-text.ts`): each acceptance stores the version it was given, and
 * that is the only way to tell later which words a creator agreed to.
 */
export const CREATOR_TERMS_VERSION = "2026-10-11";

/**
 * The terms of one campaign in one language, with the pay filled in from the program
 * config. There is deliberately no copy with both campaigns in it: they are separate
 * programs, and nobody is shown the other one's pay.
 */
export function creatorTermsMarkdown(locale: Locale, market: CreatorMarket): string {
  const euros = (value: number) => formatCurrency(value, locale);
  const si = CREATOR_TERMS.si;
  const balkans = CREATOR_TERMS.balkans;

  const values: Record<string, string> = {
    version: CREATOR_TERMS_VERSION,
    monthCap: String(PAID_VIDEOS_PER_MONTH),
    siTikTok: euros(si.perTikTok),
    siInstagram: euros(si.perInstagram),
    siVideo: euros(perVideoTotal(si)),
    siShare: String(si.codeSharePercent),
    siCap: euros(si.bonusCap),
    bkTikTok: euros(balkans.perTikTok),
    bkInstagram: euros(balkans.perInstagram),
    bkVideo: euros(perVideoTotal(balkans)),
    bkRate: euros(balkans.viewRatePer1k),
    bkCap: euros(balkans.bonusCap),
  };

  return CREATOR_TERMS_TEXT[locale]
    .replace(/<!--(si|balkans)-->\n?([\s\S]*?)<!--\/\1-->\n?/g, (_, block: CreatorMarket, body: string) =>
      market === block ? body : "",
    )
    .replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
    .replace(/\n{3,}/g, "\n\n");
}
