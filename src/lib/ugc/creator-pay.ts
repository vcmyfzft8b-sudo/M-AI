import { z } from "zod";

import { PAID_VIDEOS_PER_MONTH, type CreatorTerms } from "./creator-program.ts";

/**
 * What one creator is paid, as their contract states it.
 *
 * New creators get their campaign's standard pay (`campaignPay`). Creators already in
 * the program each have their own deal (per video, per Instagram post, per 1,000 views,
 * a share of their code's sales, a monthly fee, or a mix), so a contract sent from the
 * admin carries its own `ContractPay` and the Terms of Participation are rendered from
 * it (`creatorTermsMarkdown`). Every component is optional; zero means "not part of
 * this deal".
 *
 * Pure on purpose (relative imports, no `server-only`): the admin form and the Node
 * tests load it too.
 */
export type ContractPay = {
  /** € per eligible video published on TikTok. */
  perTikTok: number;
  /** € more when the same video also goes out on Instagram Reels (or alone, with no TikTok fee). */
  perInstagram: number;
  /** € per 1,000 views the eligible videos gain in the month. */
  viewRatePer1k: number;
  /** % of what customers actually paid with the creator's discount code. */
  codeSharePercent: number;
  /** A fixed € a month for taking part. */
  monthlyFee: number;
  /** € cap on the bonuses (views + code) a month; `null` for no cap. */
  bonusCap: number | null;
  /** Most videos paid per video in a month; `null` for no limit. */
  videosPerMonth: number | null;
  /** Anything else agreed with this creator, printed as its own clause. */
  note: string | null;
};

/** A campaign's standard pay, as every new creator's contract states it. */
export function campaignPay(terms: CreatorTerms): ContractPay {
  return {
    perTikTok: terms.perTikTok,
    perInstagram: terms.perInstagram,
    viewRatePer1k: terms.viewRatePer1k,
    codeSharePercent: terms.codeSharePercent,
    monthlyFee: 0,
    bonusCap: terms.bonusCap,
    videosPerMonth: PAID_VIDEOS_PER_MONTH,
    note: null,
  };
}

export function hasVideoPay(pay: ContractPay): boolean {
  return pay.perTikTok > 0 || pay.perInstagram > 0;
}

export function hasBonus(pay: ContractPay): boolean {
  return pay.viewRatePer1k > 0 || pay.codeSharePercent > 0;
}

const euros = (max: number) => z.coerce.number().min(0).max(max).transform((value) => Math.round(value * 100) / 100);
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" || value === undefined || value === null ? null : value), schema.nullable());

/** What the admin form sends, checked on the server; a deal must pay something. */
export const contractPaySchema = z
  .object({
    perTikTok: euros(1000),
    perInstagram: euros(1000),
    viewRatePer1k: euros(100),
    codeSharePercent: z.coerce.number().min(0).max(100),
    monthlyFee: euros(100000),
    bonusCap: optional(euros(1000000).refine((value) => value > 0)),
    videosPerMonth: optional(z.coerce.number().int().min(1).max(1000)),
    note: z.preprocess(
      (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
      z.string().max(2000).nullable(),
    ),
  })
  .refine((pay) => hasVideoPay(pay) || hasBonus(pay) || pay.monthlyFee > 0, { path: ["perTikTok"] });

/** Reads a stored or posted pay object; `null` when it is not a valid deal. */
export function parseContractPay(input: unknown): ContractPay | null {
  const result = contractPaySchema.safeParse(input);

  return result.success ? result.data : null;
}

/** The deal in one line, for the admin: "€10/video + €1 Instagram · 20% of code sales". */
export function describeContractPay(pay: ContractPay): string {
  const euros = (value: number) => `€${Number.isInteger(value) ? value : value.toFixed(2)}`;
  const parts: string[] = [];

  if (pay.perTikTok > 0) {
    parts.push(`${euros(pay.perTikTok)}/video${pay.perInstagram > 0 ? ` + ${euros(pay.perInstagram)} Instagram` : ""}`);
  } else if (pay.perInstagram > 0) {
    parts.push(`${euros(pay.perInstagram)}/Instagram video`);
  }

  if (pay.monthlyFee > 0) {
    parts.push(`${euros(pay.monthlyFee)}/month`);
  }

  if (pay.viewRatePer1k > 0) {
    parts.push(`${euros(pay.viewRatePer1k)} per 1K views`);
  }

  if (pay.codeSharePercent > 0) {
    parts.push(`${pay.codeSharePercent}% of code sales`);
  }

  if (pay.bonusCap !== null && hasBonus(pay)) {
    parts.push(`bonus cap ${euros(pay.bonusCap)}/month`);
  }

  if (pay.videosPerMonth !== null && hasVideoPay(pay)) {
    parts.push(`max ${pay.videosPerMonth} videos/month`);
  }

  if (pay.note) {
    parts.push("+ special agreement");
  }

  return parts.join(" · ");
}
