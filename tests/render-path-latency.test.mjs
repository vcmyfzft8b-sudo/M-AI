import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as locales from "../src/lib/i18n/locales.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function load(file, modules) {
  const context = { exports: {}, Headers, URL, require: name => {
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  } };
  vm.runInNewContext(ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context.exports;
}

async function forwardedHeaders(url, clientHeaders = {}) {
  let forwarded;
  const middleware = load("../src/lib/supabase/middleware.ts", {
    "@supabase/ssr": { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
    "next/server": { NextResponse: { next: ({ request }) => {
      forwarded = request.headers;
      return { cookies: { set() {} } };
    } } },
    "@/lib/i18n/locales": locales,
    "@/lib/public-env": { getPublicEnv: () => ({ supabaseUrl: "https://staging.invalid", supabaseAnonKey: "synthetic" }) },
    "@/lib/mobile/account-lifecycle": { accountDeletionRequested: () => false },
    "@/lib/verified-page-user": { VERIFIED_PAGE_USER_HEADER: "x-memo-user" },
    "@/lib/billing-access": { CHECKOUT_RETURN_HEADER: "x-memo-checkout-return" },
  });
  await middleware.updateSession({
    headers: new Headers(clientHeaders),
    nextUrl: new URL(url),
    cookies: { get: () => ({ value: "en" }), getAll: () => [], set() {} },
  });
  return forwarded;
}

test("only the page Stripe Checkout returns a buyer to is marked as a checkout return", async () => {
  const marked = await forwardedHeaders("https://memoai.eu/app/start?checkout=success");
  assert.equal(marked.get("x-memo-checkout-return"), "1");

  for (const url of [
    "https://memoai.eu/app/start",
    "https://memoai.eu/app/start?checkout=cancelled",
    "https://memoai.eu/app?checkout=success",
  ]) {
    assert.equal((await forwardedHeaders(url)).get("x-memo-checkout-return"), null, url);
  }

  // A browser cannot claim it: the mark only buys a slower page, but it is the proxy's to set.
  const forged = await forwardedHeaders("https://memoai.eu/app", { "x-memo-checkout-return": "1" });
  assert.equal(forged.get("x-memo-checkout-return"), null);
});

test("page renders reconcile Stripe after the response; API routes and the checkout return wait", () => {
  const billing = read("../src/lib/billing.ts");
  const decide = billing.slice(billing.indexOf("async function canReconcileStripeAfterResponse"));

  assert.match(decide, /pathname\.startsWith\("\/api\/"\)/);
  assert.match(decide, /requestHeaders\.get\(CHECKOUT_RETURN_HEADER\) !== "1"/);
  // Outside a request nothing can be deferred to, so it must wait rather than throw.
  assert.match(decide, /catch \{[\s\S]*?return false;/);

  const resolve = billing.slice(billing.indexOf("async function resolveUserSubscriptionState"));
  assert.match(resolve, /after\(\(\) => reconcileStripeSubscriptions\(/);
});

test("nobody waits on Stripe while they are still answering the survey", () => {
  const start = read("../src/app/app/start/page.tsx");
  assert.match(
    start,
    /appState\.onboardingComplete\s*\?\s*await getSubscriptionTrialEligibility\(appState\.user\.id\)\s*:\s*false/,
  );

  // The survey page never shows a price, so it never asks.
  const onboarding = read("../src/app/onboarding/page.tsx");
  assert.doesNotMatch(onboarding, /getSubscriptionTrialEligibility|getViewerCheckoutState/);
});

test("pages run beside the database; the lecture pipeline stays where it was", () => {
  const vercel = JSON.parse(read("../vercel.json"));
  assert.deepEqual(vercel.regions, ["dub1"]);

  for (const route of [
    "../src/app/api/inngest/route.ts",
    "../src/app/api/internal/lectures/document/route.ts",
    "../src/app/api/internal/lectures/link/route.ts",
    "../src/app/api/internal/lectures/mindmap/route.ts",
    "../src/app/api/internal/lectures/practice-test/route.ts",
    "../src/app/api/internal/lectures/process/route.ts",
    "../src/app/api/internal/lectures/quiz/route.ts",
    "../src/app/api/internal/lectures/scan/route.ts",
    "../src/app/api/internal/lectures/study/route.ts",
    "../src/app/api/internal/lectures/tutor-plan/route.ts",
    "../src/app/api/lectures/[id]/retry/route.ts",
  ]) {
    assert.match(read(route), /export const preferredRegion = "iad1";/, route);
  }
});
