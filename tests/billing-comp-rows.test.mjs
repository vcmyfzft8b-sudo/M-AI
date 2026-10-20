import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getActiveSubscription,
  hasPaidAccess,
  hasPriorSubscriptionHistory,
  isCompSubscriptionRow,
} from "../src/lib/billing-access.ts";

/*
 * A comp is free premium granted by hand to somebody with no Stripe subscription to extend: a
 * `billing_subscriptions` row with no customer, no price and an amount of 0. On 2026-10-20 four
 * free learners got three comped days as an outage apology, and because any row at all counted
 * as subscription history, each of them silently lost the three-day trial checkout still owed
 * them. These rows are the live shape (`comp_d0f265c2_20261023` and the one from 2026-08-14).
 */
const comp = (fields = {}) => ({
  id: "row-comp",
  user_id: "u1",
  stripe_customer_id: null,
  stripe_subscription_id: "comp_d0f265c2_20261023",
  stripe_price_id: null,
  plan: "monthly",
  status: "active",
  currency: "eur",
  unit_amount: 0,
  current_period_end: "2026-10-23T23:59:59+00:00",
  cancel_at_period_end: true,
  created_at: "2026-10-20T14:00:00+00:00",
  updated_at: "2026-10-20T14:00:00+00:00",
  ...fields,
});
const endedComp = (fields = {}) =>
  comp({
    id: "row-ended",
    stripe_subscription_id: "comp_605587ab_20260914",
    current_period_end: "2026-09-14T13:54:49.99+00:00",
    created_at: "2026-08-14T10:00:00+00:00",
    updated_at: "2026-08-14T10:00:00+00:00",
    ...fields,
  });
const stripeRow = (fields = {}) => ({
  id: "row-stripe",
  user_id: "u1",
  stripe_customer_id: "cus_QA123",
  stripe_subscription_id: "sub_1QA123",
  stripe_price_id: "price_monthly",
  plan: "monthly",
  status: "active",
  currency: "eur",
  unit_amount: 2000,
  current_period_end: "2026-11-02T09:00:00+00:00",
  cancel_at_period_end: false,
  created_at: "2026-10-02T09:00:00+00:00",
  updated_at: "2026-10-02T09:00:00+00:00",
  ...fields,
});

const DURING = Date.parse("2026-10-21T12:00:00Z");
const AFTER = Date.parse("2026-10-24T00:00:01Z");

test("a comp is told apart from a Stripe subscription by its id", () => {
  assert.equal(isCompSubscriptionRow(comp()), true);
  assert.equal(isCompSubscriptionRow(endedComp()), true);
  assert.equal(isCompSubscriptionRow(stripeRow()), false);
});

test("a comp, live or ended, is not subscription history: the checkout trial survives it", () => {
  assert.equal(hasPriorSubscriptionHistory(null, [comp()]), false);
  assert.equal(hasPriorSubscriptionHistory({ subscription_trial_started_at: null }, [comp()]), false);
  assert.equal(hasPriorSubscriptionHistory({ subscription_trial_started_at: null }, [endedComp()]), false);
  assert.equal(hasPriorSubscriptionHistory({ subscription_trial_started_at: null }, [comp(), endedComp()]), false);
  assert.equal(hasPriorSubscriptionHistory({ subscription_trial_started_at: null }, []), false);
});

test("a real Stripe subscription, or a trial already started, still is", () => {
  assert.equal(hasPriorSubscriptionHistory({ subscription_trial_started_at: null }, [stripeRow()]), true);
  assert.equal(
    hasPriorSubscriptionHistory({ subscription_trial_started_at: null }, [stripeRow({ status: "canceled" })]),
    true,
  );
  assert.equal(hasPriorSubscriptionHistory({ subscription_trial_started_at: null }, [comp(), stripeRow()]), true);
  assert.equal(hasPriorSubscriptionHistory({ subscription_trial_started_at: "2026-10-01T00:00:00Z" }, [comp()]), true);
});

test("a comp grants access until its end date and not a second after", () => {
  assert.equal(hasPaidAccess(comp(), DURING), true);
  assert.equal(hasPaidAccess(comp(), Date.parse("2026-10-23T23:59:58Z")), true);
  assert.equal(hasPaidAccess(comp(), AFTER), false);
  assert.equal(hasPaidAccess(endedComp(), DURING), false);
});

test("the active subscription is the live comp while it lasts", () => {
  assert.equal(getActiveSubscription([comp()], DURING)?.id, "row-comp");
  assert.equal(getActiveSubscription([endedComp(), comp()], DURING)?.id, "row-comp");
});

test("an ended comp is no subscription at all, not a plan that still says active", () => {
  assert.equal(getActiveSubscription([comp()], AFTER), null);
  assert.equal(getActiveSubscription([endedComp()], DURING), null);
});

test("a Stripe row is still the one shown, live or not, whatever comps sit beside it", () => {
  // Live and paid: wins over an ended comp updated more recently.
  assert.equal(
    getActiveSubscription([stripeRow({ updated_at: "2026-09-01T00:00:00Z" }), comp()], AFTER)?.id,
    "row-stripe",
  );
  // Cancelled before the comp: it describes the account once the comp has ended, as it did before.
  const cancelled = stripeRow({ status: "canceled", updated_at: "2026-09-01T00:00:00Z" });
  assert.equal(getActiveSubscription([comp(), cancelled], AFTER)?.id, "row-stripe");
  assert.equal(getActiveSubscription([comp(), cancelled], DURING)?.id, "row-comp");
});

test("entitlements and checkout read the comp-aware history, not a row count", () => {
  const billing = readFileSync(new URL("../src/lib/billing.ts", import.meta.url), "utf8");

  assert.doesNotMatch(billing, /subscriptions\.length\s*>\s*0/);
  assert.doesNotMatch(billing, /export function (hasPriorSubscriptionHistory|getActiveSubscription)\b/);
  assert.match(billing, /const subscriptionTrialEligible = !hasPriorSubscriptionHistory\(/);

  const checkout = readFileSync(new URL("../src/app/api/billing/checkout/route.ts", import.meta.url), "utf8");
  assert.match(checkout, /appState\.subscriptionTrialEligible && !hasPriorStripeSubscription/);
});

test("settings offers no Stripe portal for a comp", () => {
  const page = readFileSync(new URL("../src/app/app/settings/page.tsx", import.meta.url), "utf8");

  assert.match(page, /const comp = Boolean\(subscription && isCompSubscriptionRow\(subscription\)\)/);
  assert.match(page, /hasSubscription=\{Boolean\(\(subscription && !comp\) \|\| apple\)\}/);
  assert.match(page, /compSubscription=\{comp\}/);
});
