import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import { isNativeUserAgent } from "../src/lib/mobile/runtime.ts";

const NATIVE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MemoAI-iOS/1.0";
const SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

/** Loads one Stripe route with every dependency stubbed to record whether it was reached. */
function loadRoute(path) {
  const calls = [];
  class NextResponse extends Response {
    static json(data, init) { return new NextResponse(JSON.stringify(data), init); }
  }
  const reached = name => async () => { calls.push(name); return null; };
  const modules = {
    zod: { z }, "next/server": { NextResponse },
    "@/lib/mobile/runtime": { isNativeUserAgent },
    "@/lib/mobile/apple": { getAppleEntitlement: reached("apple") },
    "@/lib/billing": {
      getViewerAppState: reached("appState"), ensureStripeCustomer: reached("customer"), getStripeClient: reached("stripe"),
      getBillingCancelUrl: () => "", getBillingSuccessUrl: () => "", getBillingPortalReturnUrl: () => "", getPriceIdForPlan: () => "",
      hasStripeSubscriptionHistory: reached("history"), PURCHASABLE_BILLING_PLAN_IDS: ["monthly", "yearly"],
    },
    "@/lib/billing-access": { hasLiveStripeSubscription: () => false },
    "@/lib/discount-wheel": { getDiscountWheelState: reached("wheel") },
    "@/lib/rate-limit": { rateLimitPresets: { mutate: [] }, enforceRateLimit: reached("rateLimit") },
    "@/lib/request-validation": { parseJsonRequest: reached("parse") },
    "@/lib/i18n/locales": { STRIPE_CHECKOUT_LOCALE: {} },
    "@/lib/i18n/server": { getLocale: async () => "en", tr: async key => key },
    "@/lib/tutor-credits": { getTutorCreditPriceId: () => "", TUTOR_CREDIT_METADATA_KIND: "tutor" },
  };
  const context = { exports: {}, require: name => { if (!(name in modules)) throw new Error(`Unstubbed import ${name}`); return modules[name]; }, URL, Date };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/app/api/billing/${path}/route.ts`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { calls, post: userAgent => context.exports.POST(new Request(`https://memoai.eu/api/billing/${path}`, {
    method: "POST", headers: { "user-agent": userAgent, "content-type": "application/json" }, body: "{}",
  })) };
}

// Apple's guideline 3.1.1: the native app must never reach Stripe Checkout or the portal.
for (const path of ["checkout", "portal", "tutor-credits"]) {
  test(`${path}: the native app is refused before any Stripe or account work`, async () => {
    const route = loadRoute(path);
    const response = await route.post(NATIVE_UA);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "native_purchase_required");
    assert.deepEqual(route.calls, []);
  });
  test(`${path}: a browser still reaches the account lookup`, async () => {
    const route = loadRoute(path);
    assert.equal((await route.post(SAFARI_UA)).status, 401);
    assert.deepEqual(route.calls, ["appState"]);
  });
}
