import { formatCurrency } from "../utils.ts";
import type { Locale } from "../i18n/locales.ts";
import { CREATOR_TERMS } from "./creator-campaigns.ts";
import { campaignPay, hasBonus, hasVideoPay, type ContractPay } from "./creator-pay.ts";
import type { CreatorMarket } from "./creator-program.ts";
import { CREATOR_TERMS_TEXT } from "./creator-terms-text.ts";

/**
 * The creator program's Terms of Participation, as a creator reads and accepts them.
 *
 * Bump the version whenever the meaning of any clause changes (the text is in
 * `creator-terms-text.ts`): each acceptance stores the version it was given, and
 * that is the only way to tell later which words a creator agreed to.
 */
export const CREATOR_TERMS_VERSION = "2026-10-12.2";

type PayWords = {
  tiktokAndInstagram: string;
  tiktok: string;
  instagram: string;
  monthly: string;
  views: string;
  code: string;
  capOne: string;
  capTotal: string;
  videoLimit: string;
  noVideoLimit: string;
  noteTitle: string;
  percent: string;
};

/**
 * Section 4's pay list and 3.4's limit, in each language, built from the deal's parts so
 * any mix reads as one contract. The wording of the standard campaigns' lines is the same
 * as before individual deals existed.
 */
const PAY_WORDS: Record<Locale, PayWords> = {
  sl: {
    tiktokAndInstagram:
      "**{tiktok} za vsak upravičen video, objavljen na TikToku**, in še **{instagram}**, ko isti video objaviš tudi v Instagram Reels (skupaj do {both} na video).",
    tiktok: "**{tiktok} za vsak upravičen video, objavljen na TikToku**.",
    instagram: "**{instagram} za vsak upravičen video, objavljen v Instagram Reels**.",
    monthly: "**{monthly} na mesec** fiksnega plačila za vsak koledarski mesec sodelovanja.",
    views: "**Bonus za oglede {rate} na 1000 ogledov**, ki jih tvoji upravičeni videi zberejo v koledarskem mesecu",
    code: "**Bonus {share}** zneska, ki so ga v koledarskem mesecu dejansko plačali kupci, ki so naročnino Memo AI kupili s tvojo kodo za popust, brez DDV, vračil in povratnih bremenitev",
    capOne: ", do največ **{cap} na mesec**.",
    capTotal: "Bonusi skupaj znašajo največ **{cap} na mesec**.",
    videoLimit: "Plačilo na video velja za največ **{count} upravičenih videov na koledarski mesec**.",
    noVideoLimit: "Število videov na mesec ni omejeno.",
    noteTitle: "Poseben dogovor",
    percent: "{value} %",
  },
  en: {
    tiktokAndInstagram:
      "**{tiktok} for every Eligible Video published on TikTok**, and **{instagram} more** when you also publish the same Video on Instagram Reels (up to {both} per Video).",
    tiktok: "**{tiktok} for every Eligible Video published on TikTok**.",
    instagram: "**{instagram} for every Eligible Video published on Instagram Reels**.",
    monthly: "**{monthly} a month** as a fixed fee for every calendar month you take part.",
    views: "**A view bonus of {rate} per 1,000 Views** your Eligible Videos gain in the calendar month",
    code: "**A {share} bonus** on the amount actually paid in the calendar month by customers who bought a Memo AI subscription with your Discount Code, excluding VAT, refunds and chargebacks",
    capOne: ", up to **{cap} a month**.",
    capTotal: "The bonuses come to at most **{cap} a month** in total.",
    videoLimit: "The per-video fees are paid for at most **{count} Eligible Videos per calendar month**.",
    noVideoLimit: "There is no monthly limit on the number of Videos.",
    noteTitle: "Special agreement",
    percent: "{value}%",
  },
  hr: {
    tiktokAndInstagram:
      "**{tiktok} za svaki prihvatljiv video objavljen na TikToku** i još **{instagram}** kad isti video objaviš i u Instagram Reelsima (ukupno do {both} po videu).",
    tiktok: "**{tiktok} za svaki prihvatljiv video objavljen na TikToku**.",
    instagram: "**{instagram} za svaki prihvatljiv video objavljen u Instagram Reelsima**.",
    monthly: "**{monthly} mjesečno** kao fiksna naknada za svaki kalendarski mjesec sudjelovanja.",
    views: "**Bonus za preglede od {rate} na 1000 pregleda** koje tvoji prihvatljivi videi skupe u kalendarskom mjesecu",
    code: "**Bonus od {share}** iznosa koji su u kalendarskom mjesecu stvarno platili kupci koji su pretplatu na Memo AI kupili s tvojim kodom za popust, bez PDV-a, povrata i storniranih plaćanja",
    capOne: ", do najviše **{cap} mjesečno**.",
    capTotal: "Bonusi ukupno iznose najviše **{cap} mjesečno**.",
    videoLimit: "Naknade po videu plaćaju se za najviše **{count} prihvatljivih videa po kalendarskom mjesecu**.",
    noVideoLimit: "Broj videa mjesečno nije ograničen.",
    noteTitle: "Poseban dogovor",
    percent: "{value} %",
  },
  bs: {
    tiktokAndInstagram:
      "**{tiktok} za svaki prihvatljiv video objavljen na TikToku** i još **{instagram}** kad isti video objaviš i u Instagram Reelsima (ukupno do {both} po videu).",
    tiktok: "**{tiktok} za svaki prihvatljiv video objavljen na TikToku**.",
    instagram: "**{instagram} za svaki prihvatljiv video objavljen u Instagram Reelsima**.",
    monthly: "**{monthly} mjesečno** kao fiksna naknada za svaki kalendarski mjesec učešća.",
    views: "**Bonus za preglede od {rate} na 1000 pregleda** koje tvoji prihvatljivi videi skupe u kalendarskom mjesecu",
    code: "**Bonus od {share}** iznosa koji su u kalendarskom mjesecu stvarno platili kupci koji su pretplatu na Memo AI kupili s tvojim kodom za popust, bez PDV-a, povrata i storniranih plaćanja",
    capOne: ", do najviše **{cap} mjesečno**.",
    capTotal: "Bonusi ukupno iznose najviše **{cap} mjesečno**.",
    videoLimit: "Naknade po videu plaćaju se za najviše **{count} prihvatljivih videa po kalendarskom mjesecu**.",
    noVideoLimit: "Broj videa mjesečno nije ograničen.",
    noteTitle: "Poseban dogovor",
    percent: "{value} %",
  },
  sr: {
    tiktokAndInstagram:
      "**{tiktok} za svaki prihvatljiv snimak objavljen na TikToku** i još **{instagram}** kad isti snimak objaviš i u Instagram Reels-u (ukupno do {both} po snimku).",
    tiktok: "**{tiktok} za svaki prihvatljiv snimak objavljen na TikToku**.",
    instagram: "**{instagram} za svaki prihvatljiv snimak objavljen u Instagram Reels-u**.",
    monthly: "**{monthly} mesečno** kao fiksna naknada za svaki kalendarski mesec učešća.",
    views: "**Bonus za preglede od {rate} na 1000 pregleda** koje tvoji prihvatljivi snimci sakupe u kalendarskom mesecu",
    code: "**Bonus od {share}** iznosa koji su u kalendarskom mesecu zaista platili kupci koji su pretplatu na Memo AI kupili sa tvojim kodom za popust, bez PDV-a, povraćaja i storniranih plaćanja",
    capOne: ", do najviše **{cap} mesečno**.",
    capTotal: "Bonusi ukupno iznose najviše **{cap} mesečno**.",
    videoLimit: "Naknade po snimku plaćaju se za najviše **{count} prihvatljivih snimaka po kalendarskom mesecu**.",
    noVideoLimit: "Broj snimaka mesečno nije ograničen.",
    noteTitle: "Poseban dogovor",
    percent: "{value} %",
  },
};

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

/** The bullet list of what this deal pays, in one language. */
function payList(locale: Locale, pay: ContractPay): string {
  const words = PAY_WORDS[locale];
  const euros = (value: number) => formatCurrency(value, locale);
  const number = new Intl.NumberFormat(locale === "en" ? "en-GB" : locale, { maximumFractionDigits: 2 });
  const values = {
    tiktok: euros(pay.perTikTok),
    instagram: euros(pay.perInstagram),
    both: euros(pay.perTikTok + pay.perInstagram),
    monthly: euros(pay.monthlyFee),
    rate: euros(pay.viewRatePer1k),
    share: fill(words.percent, { value: number.format(pay.codeSharePercent) }),
    cap: pay.bonusCap === null ? "" : euros(pay.bonusCap),
  };
  const lines: string[] = [];

  if (pay.perTikTok > 0) {
    lines.push(fill(pay.perInstagram > 0 ? words.tiktokAndInstagram : words.tiktok, values));
  } else if (pay.perInstagram > 0) {
    lines.push(fill(words.instagram, values));
  }

  if (pay.monthlyFee > 0) {
    lines.push(fill(words.monthly, values));
  }

  const bonuses = [
    pay.codeSharePercent > 0 ? fill(words.code, values) : null,
    pay.viewRatePer1k > 0 ? fill(words.views, values) : null,
  ].filter((line): line is string => line !== null);

  // One bonus carries its cap in its own line, as the campaign terms always have; two
  // share one cap, stated once under them.
  const capOnEach = bonuses.length === 1 && pay.bonusCap !== null;

  for (const line of bonuses) {
    lines.push(capOnEach ? line + fill(words.capOne, values) : `${line}.`);
  }

  if (bonuses.length > 1 && pay.bonusCap !== null) {
    lines.push(fill(words.capTotal, values));
  }

  return lines.map((line) => `- ${line}`).join("\n");
}

/**
 * The terms in one language: one campaign's, with the pay of the given deal (the
 * campaign's standard pay unless a contract brings its own). There is deliberately no
 * copy with both campaigns in it: they are separate programs, and nobody is shown the
 * other one's pay.
 */
export function creatorTermsMarkdown(
  locale: Locale,
  market: CreatorMarket,
  {
    pay = campaignPay(CREATOR_TERMS[market]),
    applied = true,
  }: {
    /** This creator's deal; the campaign's standard pay when left out. */
    pay?: ContractPay;
    /** False for a creator who joined without applying (no sample video to compare against). */
    applied?: boolean;
  } = {},
): string {
  const words = PAY_WORDS[locale];
  const blocks: Record<string, boolean> = {
    si: market === "si",
    balkans: market === "balkans",
    code: pay.codeSharePercent > 0,
    views: pay.viewRatePer1k > 0,
    applied,
  };
  const values: Record<string, string> = {
    version: CREATOR_TERMS_VERSION,
    videoLimit:
      hasVideoPay(pay) && pay.videosPerMonth !== null
        ? fill(words.videoLimit, { count: String(pay.videosPerMonth) })
        : words.noVideoLimit,
    payList: payList(locale, pay),
    payNote: pay.note ? `### ${words.noteTitle}\n\n${pay.note}` : "",
  };

  return CREATOR_TERMS_TEXT[locale]
    .replace(/<!--(\w+)-->\n?([\s\S]*?)<!--\/\1-->\n?/g, (_, block: string, body: string) => (blocks[block] ? body : ""))
    .replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

export { hasBonus };
