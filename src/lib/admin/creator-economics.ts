/**
 * What each creator costs, earns and is owed.
 *
 * Three arrangements are in play at once, so the cost of a view is not one
 * number:
 *
 * - **per video** — a flat fee for every Memo AI post, whatever it does.
 * - **revenue share** — a percentage of what their own discount code actually
 *   brought in. Costs nothing until it earns something.
 * - **unpaid** — the brand's own accounts. They still produce views and revenue;
 *   they simply never appear on a payout run.
 *
 * Revenue is the creator's share of campaign value (their views at the measured
 * rate per thousand), which is deliberately *not* the same as the revenue their
 * code is credited with — see `campaign-value.ts`. Payouts on revenue share are
 * the exception: those are owed on the tracked code revenue, because that is
 * what the agreement says.
 */

import type { UgcRateKind } from "@/lib/database.types";

export type PayModel =
  | { kind: "per_video"; amountPerVideo: number }
  | { kind: "revenue_share"; percent: number }
  | { kind: "per_month"; amountPerMonth: number }
  | { kind: "per_1k_views"; amountPerMille: number }
  | { kind: "unpaid" };

export type CreatorTerms = {
  kind: "creator" | "owned";
  rate_kind: UgcRateKind | null;
  rate_amount: number | string | null;
};

/** Minor units from a decimal rate stored as euros. */
function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

export function payModelFor(creator: CreatorTerms): PayModel {
  // Our own accounts are never paid, whatever a leftover rate says.
  if (creator.kind === "owned") {
    return { kind: "unpaid" };
  }

  const amount = Number(creator.rate_amount ?? 0);

  if (!creator.rate_kind || !Number.isFinite(amount) || amount <= 0) {
    return { kind: "unpaid" };
  }

  switch (creator.rate_kind) {
    case "per_video":
      return { kind: "per_video", amountPerVideo: toMinorUnits(amount) };
    case "revenue_share":
      // Stored as a percentage, so 20 means 20%.
      return { kind: "revenue_share", percent: amount };
    case "per_month":
      return { kind: "per_month", amountPerMonth: toMinorUnits(amount) };
    case "per_1k_views":
      return { kind: "per_1k_views", amountPerMille: toMinorUnits(amount) };
  }
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

/** What this creator costs for a period, in minor units. */
export function computeCost(model: PayModel, inputs: CostInputs): number {
  switch (model.kind) {
    case "unpaid":
      return 0;
    case "per_video":
      return model.amountPerVideo * inputs.videos;
    case "revenue_share":
      return Math.round((inputs.codeRevenue * model.percent) / 100);
    case "per_month":
      return Math.round(model.amountPerMonth * (inputs.monthFraction ?? 1));
    case "per_1k_views":
      return Math.round((inputs.views / 1000) * model.amountPerMille);
  }
}

export type CreatorEconomics = {
  model: PayModel;
  /** Minor units. */
  cost: number;
  /** Minor units; null when the campaign rate is not measurable yet. */
  revenue: number | null;
  /** revenue - cost. Null when revenue is unknown. */
  margin: number | null;
  /** margin / revenue, as a fraction. Null when revenue is unknown or zero. */
  marginRate: number | null;
  /** revenue / cost. Null when nothing was spent, since that is not "infinite". */
  returnOnSpend: number | null;
  /** Cost per 1000 views, minor units. Null with no views. */
  costPerMille: number | null;
};

export function computeEconomics(
  model: PayModel,
  inputs: CostInputs & { revenue: number | null },
): CreatorEconomics {
  const cost = computeCost(model, inputs);
  const revenue = inputs.revenue;
  const margin = revenue === null ? null : revenue - cost;

  return {
    model,
    cost,
    revenue,
    margin,
    marginRate:
      revenue === null || revenue === 0 ? null : (margin as number) / revenue,
    // A creator who costs nothing has no return *on spend* to report; showing
    // infinity, or a bare "0x", would both read as a failure rather than as
    // free reach.
    returnOnSpend: revenue === null || cost === 0 ? null : revenue / cost,
    costPerMille: inputs.views > 0 ? (cost / inputs.views) * 1000 : null,
  };
}

/** Human-readable summary of the arrangement, for a table cell or a tooltip. */
export function describePayModel(model: PayModel, formatMoney: (minor: number) => string): string {
  switch (model.kind) {
    case "unpaid":
      return "Our own account — not paid";
    case "per_video":
      return `${formatMoney(model.amountPerVideo)} per video`;
    case "revenue_share":
      return `${model.percent}% of code revenue`;
    case "per_month":
      return `${formatMoney(model.amountPerMonth)} per month`;
    case "per_1k_views":
      return `${formatMoney(model.amountPerMille)} per 1K views`;
  }
}
