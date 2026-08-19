import assert from "node:assert/strict";
import test from "node:test";

import {
  computeCost,
  payTermsFor,
} from "../src/lib/admin/creator-economics.ts";
import { PAY_PLANS, planFor, planValueFor } from "../src/lib/admin/pay-plans.ts";

/**
 * The admin picks an arrangement by name; the database stores two columns. If
 * those two ever disagree, a creator opens their own edit form on somebody
 * else's terms — and gets saved on them.
 */

test("every arrangement we offer survives a round trip through storage", () => {
  for (const plan of PAY_PLANS) {
    // What the form would write for this plan.
    const rateKind = plan.rateKind === "" ? null : plan.rateKind;
    const sharePercent = plan.bonus ? 20 : null;

    assert.equal(
      planValueFor(rateKind, sharePercent),
      plan.value,
      `${plan.label} does not read back as itself`,
    );
  }
});

test("the list covers every fee kind, with and without a code bonus", () => {
  const combinations = PAY_PLANS.map(
    (plan) => `${plan.rateKind || "none"}:${plan.bonus}`,
  );

  assert.deepEqual(
    [...combinations].sort(),
    [
      "none:false",
      "none:true",
      "per_1k_views:false",
      "per_1k_views:true",
      "per_month:false",
      "per_month:true",
      "per_video:false",
      "per_video:true",
    ],
    "an arrangement we can pay is missing from the list",
  );

  assert.equal(new Set(combinations).size, combinations.length, "duplicate plan");
});

test("a bonus-only creator is not mistaken for one with no terms", () => {
  // These were the same blank "—" before, which is what hid the arrangement.
  assert.equal(planValueFor(null, 25), "bonus");
  assert.equal(planValueFor(null, null), "none");
});

test("a zero share is no bonus, even as the string Postgres returns", () => {
  assert.equal(planValueFor(null, "0"), "none");
  assert.equal(planValueFor("per_video", "0"), "per_video");
  assert.equal(planValueFor("per_video", "20"), "per_video+bonus");
});

test("a creator left on the retired revenue_share fee kind reads as a bonus", () => {
  // Migration 0029 moved these onto the percentage column; a row that somehow
  // still carries the old kind must not offer to pay it as a flat fee.
  assert.equal(planValueFor("revenue_share", 30), "bonus");
  assert.equal(planFor(planValueFor("revenue_share", 30)).rateKind, "");
});

test("the arrangement an admin picks is the one the payout run costs", () => {
  const plan = planFor("per_video+bonus");

  const cost = computeCost(
    payTermsFor({
      kind: "creator",
      rate_kind: plan.rateKind,
      rate_amount: 5,
      revenue_share_percent: 20,
    }),
    { videos: 4, views: 50_000, codeRevenue: 10_000 },
  );

  assert.equal(cost.basePay, 2000, "4 videos at €5");
  assert.equal(cost.codeBonus, 2000, "20% of €100.00");
});

test("an unknown plan value falls back to no terms rather than inventing pay", () => {
  assert.equal(planFor("something-we-removed").value, "none");
  assert.equal(planFor("").rateKind, "");
  assert.equal(planFor("").bonus, false);
});
