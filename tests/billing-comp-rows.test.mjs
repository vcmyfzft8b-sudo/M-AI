import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

import { hasPriorSubscriptionHistory, isCompSubscriptionRow } from "../src/lib/billing-access.ts";
import * as paywallLadder from "../src/lib/paywall-ladder.ts";
import * as paywallReasons from "../src/lib/paywall-reasons.ts";

/*
 * A comp is free premium granted by hand to somebody with no Stripe subscription to extend: a
 * `billing_subscriptions` row `comp_<uuid8>_<end date>` with no customer, no price and 0 €. On
 * 2026-10-20 four free learners got three comped days as an outage apology, and because any row
 * at all counted as subscription history, each of them silently lost the three-day trial checkout
 * still owed them. The comp only stops being history; every other way of having used the trial
 * still counts. The rows below are the live shapes.
 */
const comp = (fields = {}) => ({
  stripe_subscription_id: "comp_d0f265c2_20261023",
  stripe_customer_id: null,
  stripe_price_id: null,
  status: "active",
  unit_amount: 0,
  current_period_end: "2026-10-23T23:59:59+00:00",
  cancel_at_period_end: true,
  ...fields,
});
const endedComp = () =>
  comp({ stripe_subscription_id: "comp_605587ab_20260914", current_period_end: "2026-09-14T13:54:49.99+00:00" });
const stripeRow = (fields = {}) => ({
  stripe_subscription_id: "sub_1QA123",
  stripe_customer_id: "cus_QA123",
  stripe_price_id: "price_monthly",
  status: "active",
  unit_amount: 2000,
  current_period_end: "2026-11-02T09:00:00+00:00",
  cancel_at_period_end: false,
  ...fields,
});
const noTrial = { subscription_trial_started_at: null };
const eligible = (profile, rows) => !hasPriorSubscriptionHistory(profile, rows);

test("only a comp, live or ended, leaves the learner eligible for the trial", () => {
  assert.equal(eligible(noTrial, [comp()]), true);
  assert.equal(eligible(noTrial, [endedComp()]), true);
  assert.equal(eligible(noTrial, [comp(), endedComp()]), true);
  assert.equal(eligible(null, [comp()]), true);
});

test("a comp beside a real Stripe row, in any status, is not eligible", () => {
  for (const status of ["active", "trialing", "past_due", "canceled", "incomplete", "incomplete_expired", "unpaid", "paused"]) {
    assert.equal(eligible(noTrial, [comp(), stripeRow({ status })]), false, status);
    assert.equal(eligible(noTrial, [stripeRow({ status }), endedComp()]), false, status);
  }
});

test("a comp plus a trial already started (Stripe's trial path) is not eligible", () => {
  assert.equal(eligible({ subscription_trial_started_at: "2026-10-01T09:00:00Z" }, [comp()]), false);
  assert.equal(eligible({ subscription_trial_started_at: "2026-10-01T09:00:00Z" }, [endedComp()]), false);
});

test("a comp plus Apple purchase history is not eligible", () => {
  // An Apple purchase records itself as `subscription_trial_started_at = purchased_at`
  // (src/lib/mobile/apple.ts); there is no billing_subscriptions row for it at all.
  const apple = readFileSync(new URL("../src/lib/mobile/apple.ts", import.meta.url), "utf8");
  assert.match(apple, /update\(\{ subscription_trial_started_at: row\.purchased_at \}/);

  assert.equal(eligible({ subscription_trial_started_at: "2026-09-30T18:12:00Z" }, [comp()]), false);
  assert.equal(eligible({ subscription_trial_started_at: "2026-09-30T18:12:00Z" }, []), false);
});

test("a comp_-looking id that names a Stripe customer counts as history", () => {
  const withCustomer = comp({ stripe_customer_id: "cus_QA123" });

  assert.equal(isCompSubscriptionRow(withCustomer), false);
  assert.equal(eligible(noTrial, [withCustomer]), false);
  // And a sub_ id without a customer is no comp either.
  assert.equal(isCompSubscriptionRow(stripeRow({ stripe_customer_id: null })), false);
  assert.equal(eligible(noTrial, [stripeRow({ stripe_customer_id: null })]), false);
});

test("no rows and no trial date is eligible, as before", () => {
  assert.equal(eligible(noTrial, []), true);
  assert.equal(eligible(null, []), true);
});

test("entitlements take the trial answer from this rule", () => {
  const billing = readFileSync(new URL("../src/lib/billing.ts", import.meta.url), "utf8");

  assert.match(billing, /import \{[^}]*\bhasPriorSubscriptionHistory\b[^}]*\} from "@\/lib\/billing-access"/);
  assert.doesNotMatch(billing, /function hasPriorSubscriptionHistory\b/);
  assert.match(billing, /const subscriptionTrialEligible = !hasPriorSubscriptionHistory\(\s*recoveredProfile,\s*billingState\.subscriptions,\s*\)/);
});

/* ---- Checkout still asks Stripe itself, whatever the rows say ---- */

function transpile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

/** Runs a module with the named stubs; anything else it imports is an inert proxy. */
function load(path, modules) {
  const inert = new Proxy(function () {}, { get: (_, key) => (key === "__esModule" ? false : inert), apply: () => inert });
  const context = { exports: {}, require: (name) => modules[name] ?? inert, URL, Date, Math, Promise, Error, Object, Set, Boolean };
  vm.runInNewContext(transpile(path), context);
  return context.exports;
}

const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

async function checkoutWith({ rows, profile, stripeHistory }) {
  const seen = {};
  class NextResponse extends Response {
    static json(data, init) { return new NextResponse(JSON.stringify(data), init); }
  }
  const { POST } = load("../src/app/api/billing/checkout/route.ts", {
    zod: { z },
    "next/server": { NextResponse },
    "@/lib/mobile/runtime": { isNativeUserAgent: () => false },
    "@/lib/mobile/apple": { getAppleEntitlement: async () => null },
    "@/lib/billing": {
      getViewerAppState: async () => ({
        user: { id: "u1", email: "a@b.c" },
        profile,
        onboardingComplete: true,
        subscriptionTrialEligible: !hasPriorSubscriptionHistory(profile, rows),
      }),
      ensureStripeCustomer: async () => "cus_1",
      getStripeClient: () => ({
        subscriptions: { list: async () => ({ data: [] }) },
        checkout: { sessions: { create: async (params) => { seen.params = params; return { url: "https://checkout.stripe.com/x" }; } } },
      }),
      getBillingCancelUrl: () => "c",
      getBillingSuccessUrl: () => "s",
      getCheckoutPriceId: async (plan) => `price_${plan}`,
      hasStripeSubscriptionHistory: async () => stripeHistory,
      PURCHASABLE_BILLING_PLAN_IDS: ["monthly", "yearly"],
    },
    "@/lib/billing-access": { hasLiveStripeSubscription: () => false },
    "@/lib/discount-wheel": { getDiscountWheelState: async () => ({ hasUnredeemedPrize: false }) },
    "@/lib/paywall-ladder": paywallLadder,
    "@/lib/paywall-moments": { readPaywallMoments: async () => [] },
    "@/lib/paywall-reasons": paywallReasons,
    "@/lib/rate-limit": { rateLimitPresets: { mutate: [] }, enforceRateLimit: async () => null },
    "@/lib/request-validation": {
      parseJsonRequest: async (request, schema) => ({ success: true, data: schema.parse(await request.json()) }),
    },
    "@/lib/i18n/locales": { STRIPE_CHECKOUT_LOCALE: { en: "en" } },
    "@/lib/i18n/server": { GEO_COUNTRY_HEADER: "x-vercel-ip-country", getLocale: async () => "en", tr: async (key) => key },
  });
  const response = await POST(
    new Request("https://memoai.eu/api/billing/checkout", {
      method: "POST",
      headers: { "user-agent": SAFARI_UA, "content-type": "application/json" },
      body: JSON.stringify({ plan: "monthly" }),
    }),
  );
  assert.equal(response.status, 200);
  return seen.params.subscription_data.trial_period_days ?? null;
}

test("checkout gives a comp-only learner the trial", async () => {
  assert.equal(await checkoutWith({ rows: [endedComp()], profile: noTrial, stripeHistory: false }), 3);
});

test("checkout refuses the trial when Stripe has history, even with only a comp row", async () => {
  assert.equal(await checkoutWith({ rows: [endedComp()], profile: noTrial, stripeHistory: true }), null);
});

test("checkout refuses the trial for a comp beside a used trial or a real row", async () => {
  assert.equal(
    await checkoutWith({ rows: [comp()], profile: { subscription_trial_started_at: "2026-10-01T09:00:00Z" }, stripeHistory: false }),
    null,
  );
  assert.equal(await checkoutWith({ rows: [comp(), stripeRow({ status: "canceled" })], profile: noTrial, stripeHistory: false }), null);
});

test("Stripe's history lookup ignores billing_subscriptions entirely", async () => {
  const { hasStripeSubscriptionHistory } = load("../src/lib/billing.ts", {
    react: { cache: (fn) => fn },
    "@/lib/billing-regions": { ...(await import("../src/lib/billing-regions.ts")) },
  });
  const stripe = (byCustomer) => ({
    subscriptions: { list: async ({ customer }) => ({ data: byCustomer[customer] ?? [] }) },
    customers: { list: async () => ({ data: [{ id: "cus_by_email" }], has_more: false }) },
  });

  assert.equal(await hasStripeSubscriptionHistory({ stripe: stripe({ cus_1: [{ id: "sub_old", status: "canceled" }] }), customerId: "cus_1", email: null }), true);
  // A comp learner has no customer on the profile; a past subscription under their e-mail still counts.
  assert.equal(await hasStripeSubscriptionHistory({ stripe: stripe({ cus_by_email: [{ id: "sub_old", status: "canceled" }] }), customerId: null, email: "a@b.c" }), true);
  assert.equal(await hasStripeSubscriptionHistory({ stripe: stripe({}), customerId: null, email: "a@b.c" }), false);
});
