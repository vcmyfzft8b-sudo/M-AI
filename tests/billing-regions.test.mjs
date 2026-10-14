import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

import {
  REGIONAL_PLAN_PRICES,
  STANDARD_PLAN_PRICES,
  monthlyShareOfYearly,
  planPricesFor,
  pricingRegion,
  regionalPriceLookupKey,
} from "../src/lib/billing-regions.ts";
import { PLAN_LIST_PRICES } from "../src/lib/ugc/creator-program.ts";

const SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

function transpile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

/** Runs a module with the named stubs; anything else it imports is an inert proxy. */
function load(path, modules) {
  const inert = new Proxy(function () {}, { get: (_, key) => (key === "__esModule" ? false : inert), apply: () => inert });
  const context = { exports: {}, require: (name) => modules[name] ?? inert, URL, Date, Math, Promise, Error, Object };
  vm.runInNewContext(transpile(path), context);
  return context.exports;
}

test("Serbia pays the owner's price; other countries the standard one", () => {
  assert.deepEqual(planPricesFor("RS"), { monthly: 10, yearly: 50 });
  assert.deepEqual(planPricesFor("rs"), { monthly: 10, yearly: 50 });
  assert.deepEqual(planPricesFor("SI"), STANDARD_PLAN_PRICES);
  assert.deepEqual(planPricesFor(null), STANDARD_PLAN_PRICES);
  // Inherited keys are not countries.
  assert.equal(pricingRegion("__proto__"), null);
  assert.equal(pricingRegion("constructor"), null);
});

test("no regional price is above the standard one", () => {
  for (const [region, prices] of Object.entries(REGIONAL_PLAN_PRICES)) {
    assert.ok(prices.monthly < STANDARD_PLAN_PRICES.monthly, region);
    assert.ok(prices.yearly < STANDARD_PLAN_PRICES.yearly, region);
    assert.ok(prices.yearly < prices.monthly * 12, `${region}: yearly must still save`);
  }
});

test("the standard prices still match the creator program's list prices", () => {
  assert.deepEqual({ ...STANDARD_PLAN_PRICES }, { ...PLAN_LIST_PRICES });
});

test("a yearly price is spread over twelve months rounded down", () => {
  assert.equal(monthlyShareOfYearly(130), 10.83);
  assert.equal(monthlyShareOfYearly(50), 4.16);
  assert.equal(monthlyShareOfYearly(60), 5);
  assert.equal(regionalPriceLookupKey("yearly", "RS"), "memo_yearly_rs");
});

function loadCheckout({ country, body }) {
  const seen = {};
  class NextResponse extends Response {
    static json(data, init) { return new NextResponse(JSON.stringify(data), init); }
  }
  const schemaCapture = {};
  const exports = load("../src/app/api/billing/checkout/route.ts", {
    zod: { z },
    "next/server": { NextResponse },
    "@/lib/mobile/runtime": { isNativeUserAgent: () => false },
    "@/lib/mobile/apple": { getAppleEntitlement: async () => null },
    "@/lib/billing": {
      getViewerAppState: async () => ({ user: { id: "u1", email: "a@b.c" }, profile: null, onboardingComplete: true, subscriptionTrialEligible: true }),
      ensureStripeCustomer: async () => "cus_1",
      getStripeClient: () => ({
        subscriptions: { list: async () => ({ data: [] }) },
        checkout: { sessions: { create: async (params) => { seen.params = params; return { url: "https://checkout.stripe.com/x" }; } } },
      }),
      getBillingCancelUrl: () => "c", getBillingSuccessUrl: () => "s",
      getCheckoutPriceId: async (plan, ipCountry) => { seen.lookup = [plan, ipCountry]; return `price_${plan}_${ipCountry}`; },
      hasStripeSubscriptionHistory: async () => false,
      PURCHASABLE_BILLING_PLAN_IDS: ["monthly", "yearly"],
    },
    "@/lib/billing-access": { hasLiveStripeSubscription: () => false },
    "@/lib/discount-wheel": { getDiscountWheelState: async () => ({ hasUnredeemedPrize: false }) },
    "@/lib/rate-limit": { rateLimitPresets: { mutate: [] }, enforceRateLimit: async () => null },
    "@/lib/request-validation": {
      parseJsonRequest: async (request, schema) => {
        schemaCapture.schema = schema;
        return { success: true, data: schema.parse(await request.json()) };
      },
    },
    "@/lib/i18n/locales": { STRIPE_CHECKOUT_LOCALE: { en: "en" } },
    "@/lib/i18n/server": { GEO_COUNTRY_HEADER: "x-vercel-ip-country", getLocale: async () => "en", tr: async (key) => key },
  });
  const headers = { "user-agent": SAFARI_UA, "content-type": "application/json" };
  if (country) headers["x-vercel-ip-country"] = country;
  return {
    seen,
    response: exports.POST(new Request("https://memoai.eu/api/billing/checkout", { method: "POST", headers, body: JSON.stringify(body) })),
  };
}

test("checkout prices by Vercel's IP country, never by the request body", async () => {
  const { seen, response } = loadCheckout({ country: "RS", body: { plan: "yearly", country: "SI", price: "price_cheap" } });
  assert.equal((await response).status, 200);
  assert.deepEqual([...seen.lookup], ["yearly", "RS"]);
  assert.equal(seen.params.line_items[0].price, "price_yearly_RS");

  const slovenian = loadCheckout({ country: "SI", body: { plan: "monthly", country: "RS" } });
  await slovenian.response;
  assert.deepEqual([...slovenian.seen.lookup], ["monthly", "SI"]);
});

function loadBilling(prices) {
  const listed = [];
  const exports = load("../src/lib/billing.ts", {
    react: { cache: (fn) => fn },
    stripe: { __esModule: true, default: class { constructor() { return { prices: { list: async (params) => { listed.push(params.lookup_keys[0]); return { data: prices[params.lookup_keys[0]] ?? [] }; } } }; } } },
    "@/lib/billing-regions": { ...awaitedRegions },
    "@/lib/server-env": { getServerEnv: () => ({ STRIPE_SECRET_KEY: "sk_test", STRIPE_PRICE_MONTHLY: "price_std_m", STRIPE_PRICE_YEARLY: "price_std_y", STRIPE_PRICE_WEEKLY: "price_std_w" }) },
  });
  return { listed, ...exports };
}
const awaitedRegions = await import("../src/lib/billing-regions.ts");

test("a regional checkout uses the Stripe price at the advertised amount, or fails", async () => {
  const billing = loadBilling({
    memo_yearly_rs: [{ id: "price_rs_y", unit_amount: 5000, currency: "eur" }],
    memo_monthly_rs: [{ id: "price_rs_m_wrong", unit_amount: 2000, currency: "eur" }],
  });
  assert.equal(await billing.getCheckoutPriceId("yearly", "RS"), "price_rs_y");
  assert.equal(await billing.getCheckoutPriceId("yearly", "RS"), "price_rs_y");
  assert.equal(billing.listed.length, 1, "looked up once per instance");
  // A Stripe price that would charge more than the paywall said is refused.
  await assert.rejects(billing.getCheckoutPriceId("monthly", "RS"), /not €10/);
  // A missing one too.
  await assert.rejects(billing.getCheckoutPriceId("monthly", "BA"), /missing/);
  // Everyone else stays on the configured price, without asking Stripe.
  assert.equal(await billing.getCheckoutPriceId("monthly", "SI"), "price_std_m");
  assert.equal(await billing.getCheckoutPriceId("yearly", null), "price_std_y");
});

test("a regional subscription is recorded on the right plan", () => {
  const billing = loadBilling({});
  assert.equal(billing.getPlanFromStripePrice({ id: "price_std_y", recurring: { interval: "month" } }), "yearly");
  assert.equal(billing.getPlanFromStripePrice({ id: "price_rs_y", recurring: { interval: "year" } }), "yearly");
  assert.equal(billing.getPlanFromStripePrice({ id: "price_rs_m", recurring: { interval: "month" } }), "monthly");
  assert.equal(billing.getPlanFromStripePrice(null), null);
});

test("the paywall offers the regional amounts", () => {
  const billing = loadBilling({});
  const [monthly, yearly] = billing.purchasableBillingPlansFor("RS");
  assert.equal(monthly.amount, 10);
  assert.equal(monthly.annualizedAmount, 120);
  assert.equal(yearly.amount, 50);
  assert.equal(yearly.displayAmount, 4.16);
  const [stdMonthly, stdYearly] = billing.purchasableBillingPlansFor("SI");
  assert.equal(stdMonthly.amount, 20);
  assert.equal(stdYearly.displayAmount, 10.83);
});

test("the iOS app is never priced by region", () => {
  const source = readFileSync(new URL("../src/lib/billing.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function getPricingCountry"));
  assert.match(body.slice(0, 400), /isNativeUserAgent\(requestHeaders\.get\("user-agent"\)\)[\s\S]*return null/);
});
