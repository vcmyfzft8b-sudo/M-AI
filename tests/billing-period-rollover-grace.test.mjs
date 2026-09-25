import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  hasLiveStripeSubscription,
  hasPaidAccess,
  PERIOD_ROLLOVER_GRACE_MS,
} from "../src/lib/billing-access.ts";

// 2026-09-13: a 3-day trial ended at 12:14:50; the tutor refused the learner at
// 12:15:15, before Stripe had billed the first month, and the paywall sold them a
// second subscription.
const TRIAL_END = "2026-09-13T12:14:50Z";
const REFUSED_AT = Date.parse("2026-09-13T12:15:15Z");
const row = (fields) => ({ status: "trialing", current_period_end: TRIAL_END, cancel_at_period_end: false, ...fields });

test("a renewing plan keeps access in the seconds after its stored period ends", () => {
  assert.equal(hasPaidAccess(row({ status: "trialing" }), REFUSED_AT), true);
  assert.equal(hasPaidAccess(row({ status: "active" }), REFUSED_AT), true);
});

test("the grace is bounded", () => {
  const after = Date.parse(TRIAL_END) + PERIOD_ROLLOVER_GRACE_MS + 1000;
  assert.equal(hasPaidAccess(row({ status: "active" }), after), false);
});

test("a plan the learner cancelled ends exactly on time", () => {
  assert.equal(hasPaidAccess(row({ status: "active", cancel_at_period_end: true }), Date.parse(TRIAL_END) + 1000), false);
  assert.equal(hasPaidAccess(row({ status: "active", cancel_at_period_end: true }), Date.parse(TRIAL_END) - 1000), true);
});

test("ended statuses get no grace; past_due and open-ended rows behave as before", () => {
  for (const status of ["canceled", "incomplete_expired", "unpaid", "incomplete"]) {
    assert.equal(hasPaidAccess(row({ status }), REFUSED_AT), false, status);
  }
  assert.equal(hasPaidAccess(row({ status: "past_due" }), REFUSED_AT), true);
  assert.equal(hasPaidAccess(row({ status: "active", current_period_end: null }), REFUSED_AT), true);
  assert.equal(hasPaidAccess(null, REFUSED_AT), false);
});

test("checkout sees a live subscription whatever our stored row says", () => {
  assert.equal(hasLiveStripeSubscription([{ status: "canceled" }, { status: "trialing" }]), true);
  assert.equal(hasLiveStripeSubscription([{ status: "active" }]), true);
  assert.equal(hasLiveStripeSubscription([{ status: "past_due" }]), true);
  assert.equal(hasLiveStripeSubscription([{ status: "canceled" }, { status: "incomplete_expired" }]), false);
  assert.equal(hasLiveStripeSubscription([]), false);
});

test("checkout refuses a second subscription before it creates a session", () => {
  const source = readFileSync(new URL("../src/app/api/billing/checkout/route.ts", import.meta.url), "utf8");
  const guard = source.indexOf("hasLiveStripeSubscription(existing.data)");
  assert.ok(guard > 0, "checkout asks Stripe for live subscriptions");
  assert.ok(guard < source.indexOf("stripe.checkout.sessions.create"), "before creating the session");
  assert.match(source.slice(guard, guard + 300), /status: 409/);
});

test("billing.ts takes its access rule from the tested module", () => {
  const source = readFileSync(new URL("../src/lib/billing.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ hasPaidAccess \} from "@\/lib\/billing-access"/);
  assert.doesNotMatch(source, /function subscriptionPeriodAllowsAccess/);
});
