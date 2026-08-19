/**
 * The pay arrangements an admin can pick from, and how each maps onto storage.
 *
 * Pay lives in two independent columns — a flat fee (`rate_kind` plus
 * `rate_amount`) and a share of what the creator's own code sells
 * (`revenue_share_percent`) — and `creator-economics.ts` pays out on both. Any
 * combination of the two is a real arrangement we use.
 *
 * The form used to expose those columns raw, as a "Rate type" list of three fee
 * kinds with a separate percentage field further down. Every combination was
 * technically reachable, but nothing said so, and the two arrangements with no
 * fee kind — a code bonus on its own, and no terms agreed yet — were both the
 * same blank "—". Naming the arrangements here makes the whole set visible in
 * one list; the columns underneath are unchanged.
 */

import type { UgcRateKind } from "@/lib/database.types";

export type PayPlan = {
  value: string;
  label: string;
  /** Empty when the arrangement carries no flat fee. */
  rateKind: UgcRateKind | "";
  bonus: boolean;
  /** Completes "€X …" on the fee field's label. */
  unit?: string;
  hint: string;
};

export const PAY_PLANS: PayPlan[] = [
  {
    value: "none",
    label: "Not paid yet — no terms agreed",
    rateKind: "",
    bonus: false,
    hint: "They cost nothing, so they show as free reach until terms are agreed.",
  },
  {
    value: "per_video",
    label: "Flat fee per video",
    rateKind: "per_video",
    bonus: false,
    unit: "per Memo AI video",
    hint: "Owed for every Memo AI post in the period, whatever it goes on to do.",
  },
  {
    value: "per_video+bonus",
    label: "Flat fee per video + code bonus",
    rateKind: "per_video",
    bonus: true,
    unit: "per Memo AI video",
    hint: "The usual arrangement: paid per post, plus a share of what their code sells.",
  },
  {
    value: "per_month",
    label: "Monthly retainer",
    rateKind: "per_month",
    bonus: false,
    unit: "per month",
    hint: "Owed for the month however much they post. Part-months are pro-rated.",
  },
  {
    value: "per_month+bonus",
    label: "Monthly retainer + code bonus",
    rateKind: "per_month",
    bonus: true,
    unit: "per month",
    hint: "A retainer for the month, plus a share of what their code sells.",
  },
  {
    value: "per_1k_views",
    label: "Rate per 1000 views",
    rateKind: "per_1k_views",
    bonus: false,
    unit: "per 1000 views",
    hint: "Scales with the views their Memo AI posts actually earn in the period.",
  },
  {
    value: "per_1k_views+bonus",
    label: "Rate per 1000 views + code bonus",
    rateKind: "per_1k_views",
    bonus: true,
    unit: "per 1000 views",
    hint: "Paid on views, plus a share of what their code sells.",
  },
  {
    value: "bonus",
    label: "Code bonus only — no flat fee",
    rateKind: "",
    bonus: true,
    hint: "Costs nothing until their code earns. Needs a promo code to be worth anything.",
  },
];

export function planFor(value: string): PayPlan {
  return PAY_PLANS.find((entry) => entry.value === value) ?? PAY_PLANS[0];
}

/**
 * The arrangement a stored creator is already on.
 *
 * `revenue_share_percent` is a Postgres `numeric`, which the client hands back
 * as a string, so it is read as a number rather than tested for truthiness —
 * `"0"` is truthy and would have shown an unpaid creator as being on a bonus.
 */
export function planValueFor(
  rateKind: UgcRateKind | null | undefined,
  sharePercent: number | string | null | undefined,
): string {
  const share = Number(sharePercent ?? 0);
  const bonus = Number.isFinite(share) && share > 0;

  // `revenue_share` was itself a fee kind before migration 0029 moved those
  // creators onto the percentage column. A row still carrying it is a bonus.
  const fee =
    rateKind && rateKind !== "revenue_share" ? (rateKind as UgcRateKind) : "";

  if (!fee) {
    return bonus ? "bonus" : "none";
  }

  return bonus ? `${fee}+bonus` : fee;
}
