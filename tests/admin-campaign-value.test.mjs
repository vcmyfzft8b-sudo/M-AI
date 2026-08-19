import assert from "node:assert/strict";
import test from "node:test";

import {
  computeViewValue,
  estimateRevenue,
  MIN_VIEWS_FOR_RATE,
  viewsForRevenue,
} from "../src/lib/admin/campaign-value.ts";

test("a view is worth revenue divided by views, per thousand", () => {
  // €500.00 from 250,000 views = €2.00 per 1000.
  const value = computeViewValue({ revenue: 50_000, views: 250_000, days: 30 });

  assert.equal(value.revenuePerMille, 200);
  assert.equal(value.reliable, true);
});

test("a creator's share is their own views at that rate", () => {
  const value = computeViewValue({ revenue: 50_000, views: 250_000, days: 30 });

  // 34,354 views x €2.00 per 1000.
  assert.equal(estimateRevenue(34_354, value), 6871);
  assert.equal(estimateRevenue(0, value), 0);
});

test("the rate is withheld until there is enough to measure it", () => {
  // The guard this encodes: a handful of views against a month of revenue
  // produces an absurd per-view figure that would then be multiplied across
  // every creator.
  const thin = computeViewValue({
    revenue: 50_000,
    views: MIN_VIEWS_FOR_RATE - 1,
    days: 30,
  });

  assert.equal(thin.reliable, false);
  assert.equal(thin.revenuePerMille, null);
  assert.equal(estimateRevenue(10_000, thin), null, "no rate means no estimate");
});

test("no revenue yet means no rate rather than zero", () => {
  const value = computeViewValue({ revenue: 0, views: 500_000, days: 30 });

  assert.equal(value.reliable, false);
  assert.equal(value.revenuePerMille, null);
});

test("the rate inverts to answer how many views a target needs", () => {
  const value = computeViewValue({ revenue: 50_000, views: 250_000, days: 30 });

  // €1,000.00 at €2.00 per 1000 views.
  assert.equal(viewsForRevenue(100_000, value), 500_000);
  assert.equal(viewsForRevenue(100_000, computeViewValue({ revenue: 0, views: 0, days: 30 })), null);
});

test("more revenue against the same views raises what a view is worth", () => {
  const before = computeViewValue({ revenue: 50_000, views: 250_000, days: 30 });
  const after = computeViewValue({ revenue: 80_000, views: 250_000, days: 30 });

  assert.ok(after.revenuePerMille > before.revenuePerMille);
  assert.ok(estimateRevenue(10_000, after) > estimateRevenue(10_000, before));
});
