/**
 * What each creator costs, earns and is owed.
 *
 * Pay has two independent parts, and a creator can be on either, both, or
 * neither:
 *
 * - **base pay** — a flat fee, normally per Memo AI video, owed whatever the
 *   video does.
 * - **code bonus** — a percentage of what their own discount code actually
 *   brought in. Costs nothing until it earns something.
 *
 * They were originally modelled as one exclusive choice, which could not
 * express the real arrangement: the per-video creators are paid their fee *and*
 * a share of their code. A creator on both could only be recorded as one, and
 * was underpaid by the other.
 *
 * Our own accounts are never paid, whatever is left on their row.
 *
 * Note the asymmetry with `campaign-value.ts`: a creator's *revenue* is their
 * share of campaign value (their views at the measured rate per thousand),
 * because most buyers never type a code. Their *bonus* is on tracked code
 * revenue, because that is what the agreement says.
 */

import type { UgcRateKind } from "@/lib/database.types";

export type BaseFee =
  | { kind: "per_video"; amountPerVideo: number }
  | { kind: "per_month"; amountPerMonth: number }
  | { kind: "per_1k_views"; amountPerMille: number };

export type PayTerms = {
  /** Null when they are on a bonus only, or not paid at all. */
  baseFee: BaseFee | null;
  /** Null when they get no share of their code's revenue. */
  revenueSharePercent: number | null;
  /** True for our own accounts, which never appear on a payout run. */
  unpaid: boolean;
};

export type CreatorTerms = {
  kind: "creator" | "owned";
  rate_kind: UgcRateKind | null;
  rate_amount: number | string | null;
  revenue_share_percent: number | string | null;
};

/** Minor units from a decimal rate stored as euros. */
function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

function readBaseFee(creator: CreatorTerms): BaseFee | null {
  const amount = Number(creator.rate_amount ?? 0);

  if (!creator.rate_kind || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  switch (creator.rate_kind) {
    case "per_video":
      return { kind: "per_video", amountPerVideo: toMinorUnits(amount) };
    case "per_month":
      return { kind: "per_month", amountPerMonth: toMinorUnits(amount) };
    case "per_1k_views":
      return { kind: "per_1k_views", amountPerMille: toMinorUnits(amount) };
    // `revenue_share` is no longer a fee kind; migration 0029 moved any such
    // creator onto `revenue_share_percent`. Treated as no fee if one survives.
    case "revenue_share":
      return null;
  }
}

export function payTermsFor(creator: CreatorTerms): PayTerms {
  if (creator.kind === "owned") {
    return { baseFee: null, revenueSharePercent: null, unpaid: true };
  }

  const share = Number(creator.revenue_share_percent ?? 0);

  return {
    baseFee: readBaseFee(creator),
    revenueSharePercent:
      Number.isFinite(share) && share > 0 ? share : null,
    unpaid: false,
  };
}

export type CostInputs = {
  /** Memo AI posts in the period being costed. */
  videos: number;
  /** Views in that period. */
  views: number;
  /** Revenue credited to this creator's codes in that period, minor units. */
  codeRevenue: number;
  /** Fraction of a month the period covers, for a monthly retainer. */
  monthFraction?: number;
};

export type CostBreakdown = {
  /** Minor units owed as a flat fee. */
  basePay: number;
  /** Minor units owed as a share of code revenue. */
  codeBonus: number;
  /** basePay + codeBonus. */
  total: number;
};

/** What this creator costs for a period, split into its two parts. */
export function computeCost(terms: PayTerms, inputs: CostInputs): CostBreakdown {
  if (terms.unpaid) {
    return { basePay: 0, codeBonus: 0, total: 0 };
  }

  let basePay = 0;

  if (terms.baseFee) {
    switch (terms.baseFee.kind) {
      case "per_video":
        basePay = terms.baseFee.amountPerVideo * inputs.videos;
        break;
      case "per_month":
        basePay = Math.round(
          terms.baseFee.amountPerMonth * (inputs.monthFraction ?? 1),
        );
        break;
      case "per_1k_views":
        basePay = Math.round((inputs.views / 1000) * terms.baseFee.amountPerMille);
        break;
    }
  }

  const codeBonus =
    terms.revenueSharePercent === null
      ? 0
      : Math.round((inputs.codeRevenue * terms.revenueSharePercent) / 100);

  return { basePay, codeBonus, total: basePay + codeBonus };
}

export type CreatorEconomics = {
  terms: PayTerms;
  cost: CostBreakdown;
  /**
   * Views multiplied by the campaign rate. Minor units, null when the rate is
   * not measurable yet. A model of what the views are worth, not money taken,
   * so it is reported but never used as the basis of a margin.
   */
  revenue: number | null;
  /**
   * Money actually taken through this creator's codes, minor units.
   *
   * The real figure the margin is built on. It is a floor rather than a
   * measure: most people who buy after seeing a video never type a code, so
   * anything it attributes did happen, while plenty that it misses did too.
   */
  codeRevenue: number;
  /** codeRevenue - cost. Real money in, real money out. */
  margin: number;
  /** margin / codeRevenue, as a fraction. Null when no code revenue. */
  marginRate: number | null;
  /** codeRevenue / cost. Null when nothing was spent, since that is not "infinite". */
  returnOnSpend: number | null;
  /** Cost per 1000 views, minor units. Null with no views. */
  costPerMille: number | null;
};

export function computeEconomics(
  terms: PayTerms,
  inputs: CostInputs & { revenue: number | null },
): CreatorEconomics {
  const cost = computeCost(terms, inputs);
  const revenue = inputs.revenue;
  // Margin is real money in minus real money out. It used to be struck against
  // the view-based estimate, which meant it could look healthy on a creator who
  // had never produced a sale -- the estimate rises with views whether or not
  // anyone buys, so it could only ever flatter the arrangement.
  const codeRevenue = inputs.codeRevenue;
  const margin = codeRevenue - cost.total;

  return {
    terms,
    cost,
    revenue,
    codeRevenue,
    margin,
    marginRate: codeRevenue === 0 ? null : margin / codeRevenue,
    // A creator who costs nothing has no return *on spend* to report; showing
    // infinity, or a bare "0x", would both read as a failure rather than as
    // free reach.
    returnOnSpend: cost.total === 0 ? null : codeRevenue / cost.total,
    costPerMille: inputs.views > 0 ? (cost.total / inputs.views) * 1000 : null,
  };
}

/** Human-readable summary of the arrangement, for a table cell or a tooltip. */
export function describePayTerms(
  terms: PayTerms,
  formatMoney: (minor: number) => string,
): string {
  if (terms.unpaid) {
    return "Our own account — not paid";
  }

  const parts: string[] = [];

  if (terms.baseFee) {
    switch (terms.baseFee.kind) {
      case "per_video":
        parts.push(`${formatMoney(terms.baseFee.amountPerVideo)} per video`);
        break;
      case "per_month":
        parts.push(`${formatMoney(terms.baseFee.amountPerMonth)} per month`);
        break;
      case "per_1k_views":
        parts.push(`${formatMoney(terms.baseFee.amountPerMille)} per 1K views`);
        break;
    }
  }

  if (terms.revenueSharePercent !== null) {
    parts.push(`${terms.revenueSharePercent}% of code revenue`);
  }

  return parts.length > 0 ? parts.join(" + ") : "No terms recorded";
}
