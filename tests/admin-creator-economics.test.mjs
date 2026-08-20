import assert from "node:assert/strict";
import test from "node:test";

import {
  computeCost,
  computeEconomics,
  describePayTerms,
  payTermsFor,
} from "../src/lib/admin/creator-economics.ts";

const money = (minor) => `€${(minor / 100).toFixed(2)}`;

const creator = (overrides = {}) => ({
  kind: "creator",
  rate_kind: null,
  rate_amount: null,
  revenue_share_percent: null,
  ...overrides,
});

test("a per-video creator on a share is paid both, not one or the other", () => {
  // The bug this guards: pay was modelled as a single exclusive choice, so a
  // creator on €5 a video *and* 20% of their code could only be recorded as
  // one of them, and was silently underpaid by the other.
  const terms = payTermsFor(
    creator({ rate_kind: "per_video", rate_amount: 5, revenue_share_percent: 20 }),
  );

  const cost = computeCost(terms, { videos: 6, views: 72_300, codeRevenue: 15_000 });

  assert.equal(cost.basePay, 3000, "6 videos at €5");
  assert.equal(cost.codeBonus, 3000, "20% of €150.00");
  assert.equal(cost.total, 6000);
});

test("the two parts stay separate so a payout can be explained", () => {
  const terms = payTermsFor(
    creator({ rate_kind: "per_video", rate_amount: 5, revenue_share_percent: 20 }),
  );

  const cost = computeCost(terms, { videos: 2, views: 1000, codeRevenue: 0 });

  assert.equal(cost.basePay, 1000);
  assert.equal(cost.codeBonus, 0, "no code sales means no bonus, but the fee stands");
  assert.equal(cost.total, 1000);
});

test("a fee-only creator earns no bonus however well their code sells", () => {
  // Lara is paid €22 a video and takes no share.
  const terms = payTermsFor(creator({ rate_kind: "per_video", rate_amount: 22 }));

  assert.equal(terms.revenueSharePercent, null);

  const cost = computeCost(terms, { videos: 2, views: 12_500, codeRevenue: 50_000 });

  assert.equal(cost.basePay, 4400);
  assert.equal(cost.codeBonus, 0);
  assert.equal(cost.total, 4400);
});

test("a bonus-only creator costs nothing until their code sells", () => {
  const terms = payTermsFor(creator({ revenue_share_percent: 20 }));

  assert.equal(terms.baseFee, null);

  assert.deepEqual(computeCost(terms, { videos: 9, views: 99_999, codeRevenue: 0 }), {
    basePay: 0,
    codeBonus: 0,
    total: 0,
  });
  assert.equal(
    computeCost(terms, { videos: 0, views: 0, codeRevenue: 8500 }).codeBonus,
    1700,
    "20% of €85.00",
  );
});

test("our own accounts are never paid, whatever is left on the row", () => {
  const terms = payTermsFor(
    creator({
      kind: "owned",
      rate_kind: "per_video",
      rate_amount: 5,
      revenue_share_percent: 20,
    }),
  );

  assert.equal(terms.unpaid, true);
  assert.deepEqual(
    computeCost(terms, { videos: 18, views: 104_000, codeRevenue: 50_000 }),
    { basePay: 0, codeBonus: 0, total: 0 },
  );
});

test("no terms recorded costs nothing rather than guessing", () => {
  const terms = payTermsFor(creator());

  assert.equal(terms.baseFee, null);
  assert.equal(terms.revenueSharePercent, null);
  assert.equal(computeCost(terms, { videos: 5, views: 1000, codeRevenue: 9999 }).total, 0);
});

test("a zero or blank share is not a share", () => {
  assert.equal(payTermsFor(creator({ revenue_share_percent: 0 })).revenueSharePercent, null);
  assert.equal(payTermsFor(creator({ revenue_share_percent: null })).revenueSharePercent, null);
  // Stored as numeric, so it can arrive as a string.
  assert.equal(payTermsFor(creator({ revenue_share_percent: "20" })).revenueSharePercent, 20);
});

test("margin is code revenue less the whole cost, both parts included", () => {
  const terms = payTermsFor(
    creator({ rate_kind: "per_video", rate_amount: 5, revenue_share_percent: 20 }),
  );

  const economics = computeEconomics(terms, {
    videos: 6,
    views: 72_300,
    codeRevenue: 10_000,
    revenue: 30_170,
  });

  assert.equal(economics.cost.basePay, 3000);
  assert.equal(economics.cost.codeBonus, 2000);
  assert.equal(economics.cost.total, 5000);
  // Real money in less real money out: 10,000 taken, 5,000 paid.
  assert.equal(economics.margin, 5000);
  assert.equal(economics.marginRate, 0.5);
  assert.ok(Math.abs(economics.returnOnSpend - 10_000 / 5000) < 1e-9);
  // The estimate is still reported, just never used to strike the margin.
  assert.equal(economics.revenue, 30_170);
});

test("a creator with plenty of views but no sales shows a loss", () => {
  // The whole reason margin moved off the estimate. On views alone this looked
  // like a healthy margin; nobody actually bought anything.
  const economics = computeEconomics(
    payTermsFor(creator({ rate_kind: "per_video", rate_amount: 5 })),
    { videos: 4, views: 500_000, codeRevenue: 0, revenue: 200_000 },
  );

  assert.equal(economics.cost.total, 2000);
  assert.equal(economics.margin, -2000);
  // No code revenue is nothing to take a percentage of.
  assert.equal(economics.marginRate, null);
  assert.equal(economics.returnOnSpend, 0);
});

test("free reach reports no return on spend rather than infinity", () => {
  const economics = computeEconomics(
    { baseFee: null, revenueSharePercent: null, unpaid: true },
    { videos: 18, views: 104_000, codeRevenue: 0, revenue: 43_244 },
  );

  assert.equal(economics.cost.total, 0);
  // Costs nothing and sold nothing, so it neither made nor lost money.
  assert.equal(economics.margin, 0);
  assert.equal(economics.returnOnSpend, null);
});

test("an unmeasurable campaign rate no longer leaves the margin unknown", () => {
  // The estimate can be unavailable; what was paid and what the codes took are
  // both known regardless, so the margin is still a real number.
  const economics = computeEconomics(
    payTermsFor(creator({ rate_kind: "per_video", rate_amount: 5 })),
    { videos: 2, views: 100, codeRevenue: 0, revenue: null },
  );

  assert.equal(economics.cost.total, 1000);
  assert.equal(economics.revenue, null);
  assert.equal(economics.margin, -1000);
  assert.equal(economics.marginRate, null);
});

test("the arrangement describes itself, including the combined one", () => {
  assert.equal(
    describePayTerms(
      payTermsFor(
        creator({ rate_kind: "per_video", rate_amount: 5, revenue_share_percent: 20 }),
      ),
      money,
    ),
    "€5.00 per video + 20% of code revenue",
  );
  assert.equal(
    describePayTerms(payTermsFor(creator({ rate_kind: "per_video", rate_amount: 22 })), money),
    "€22.00 per video",
  );
  assert.equal(
    describePayTerms(payTermsFor(creator({ revenue_share_percent: 20 })), money),
    "20% of code revenue",
  );
  assert.equal(
    describePayTerms(payTermsFor(creator({ kind: "owned" })), money),
    "Our own account — not paid",
  );
});
