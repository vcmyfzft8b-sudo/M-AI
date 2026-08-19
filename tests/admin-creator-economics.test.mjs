import assert from "node:assert/strict";
import test from "node:test";

import {
  computeCost,
  computeEconomics,
  describePayModel,
  payModelFor,
} from "../src/lib/admin/creator-economics.ts";

const money = (minor) => `€${(minor / 100).toFixed(2)}`;

test("a per-video creator costs their fee times their posts", () => {
  const model = payModelFor({
    kind: "creator",
    rate_kind: "per_video",
    rate_amount: 5,
  });

  assert.deepEqual(model, { kind: "per_video", amountPerVideo: 500 });
  // Six posts at €5.
  assert.equal(computeCost(model, { videos: 6, views: 72_300, codeRevenue: 0 }), 3000);
  // A per-video creator costs the same whether or not their code sells.
  assert.equal(
    computeCost(model, { videos: 6, views: 72_300, codeRevenue: 40_000 }),
    3000,
  );
});

test("Lara's higher per-video fee is read from her own rate", () => {
  const model = payModelFor({
    kind: "creator",
    rate_kind: "per_video",
    rate_amount: 22,
  });

  assert.equal(computeCost(model, { videos: 1, views: 11_900, codeRevenue: 0 }), 2200);
});

test("a revenue-share creator costs a cut of what their code actually sold", () => {
  const model = payModelFor({
    kind: "creator",
    rate_kind: "revenue_share",
    rate_amount: 20,
  });

  assert.deepEqual(model, { kind: "revenue_share", percent: 20 });
  // 20% of €150.00 of code revenue.
  assert.equal(computeCost(model, { videos: 4, views: 18_800, codeRevenue: 15_000 }), 3000);
  // Costs nothing until it earns something, however much they post.
  assert.equal(computeCost(model, { videos: 9, views: 99_999, codeRevenue: 0 }), 0);
});

test("our own accounts are never paid, even with a rate left on the row", () => {
  // The guard this encodes: the brand account and Klara are ours. A stale rate
  // must not put them on a payout run.
  const model = payModelFor({
    kind: "owned",
    rate_kind: "per_video",
    rate_amount: 5,
  });

  assert.deepEqual(model, { kind: "unpaid" });
  assert.equal(computeCost(model, { videos: 18, views: 104_000, codeRevenue: 50_000 }), 0);
});

test("a creator with no terms recorded costs nothing rather than guessing", () => {
  assert.deepEqual(
    payModelFor({ kind: "creator", rate_kind: null, rate_amount: null }),
    { kind: "unpaid" },
  );
  assert.deepEqual(
    payModelFor({ kind: "creator", rate_kind: "per_video", rate_amount: 0 }),
    { kind: "unpaid" },
  );
});

test("margin is revenue less cost, with a rate per view", () => {
  const model = payModelFor({
    kind: "creator",
    rate_kind: "per_video",
    rate_amount: 5,
  });

  const economics = computeEconomics(model, {
    videos: 6,
    views: 72_300,
    codeRevenue: 0,
    revenue: 30_170,
  });

  assert.equal(economics.cost, 3000);
  assert.equal(economics.margin, 27_170);
  assert.ok(Math.abs(economics.marginRate - 27_170 / 30_170) < 1e-9);
  // €301.70 back on €30.00 spent.
  assert.ok(Math.abs(economics.returnOnSpend - 30_170 / 3000) < 1e-9);
  // €30.00 across 72,300 views, per thousand.
  assert.ok(Math.abs(economics.costPerMille - (3000 / 72_300) * 1000) < 1e-9);
});

test("free reach reports no return on spend rather than infinity", () => {
  const economics = computeEconomics(
    { kind: "unpaid" },
    { videos: 18, views: 104_000, codeRevenue: 0, revenue: 43_244 },
  );

  assert.equal(economics.cost, 0);
  assert.equal(economics.margin, 43_244);
  // Dividing by a zero spend would read as a failure, or print Infinity.
  assert.equal(economics.returnOnSpend, null);
  assert.equal(economics.costPerMille, 0);
});

test("an unmeasurable campaign rate leaves margin unknown, not zero", () => {
  const economics = computeEconomics(
    { kind: "per_video", amountPerVideo: 500 },
    { videos: 2, views: 100, codeRevenue: 0, revenue: null },
  );

  assert.equal(economics.cost, 1000);
  assert.equal(economics.margin, null);
  assert.equal(economics.marginRate, null);
});

test("each arrangement describes itself for the table", () => {
  assert.equal(
    describePayModel({ kind: "per_video", amountPerVideo: 500 }, money),
    "€5.00 per video",
  );
  assert.equal(
    describePayModel({ kind: "revenue_share", percent: 20 }, money),
    "20% of code revenue",
  );
  assert.equal(
    describePayModel({ kind: "unpaid" }, money),
    "Our own account — not paid",
  );
});
