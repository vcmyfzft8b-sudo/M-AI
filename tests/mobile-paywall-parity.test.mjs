import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "../src/lib/i18n/messages/en.ts";
import { createTranslator } from "../src/lib/i18n/translate.ts";
import { APPLE_PRODUCTS } from "../src/lib/mobile/runtime.ts";
import * as paywallLadder from "../src/lib/paywall-ladder.ts";

const t = createTranslator("en", [en]);
const plans = [
  { id: "monthly", labelKey: "billing.plan.monthly", amount: 20, annualizedAmount: 240 },
  { id: "yearly", labelKey: "billing.plan.yearly", amount: 130, displayAmount: 130 / 12, annualizedAmount: 130 },
];
function load(component, native, products = []) {
  const apple = {
    products, selected: products.find(p => p.id.endsWith("yearly"))?.id ?? "eu.memoai.premium.trial.yearly",
    busy: false, notice: "", purchase() {}, restore() {}, selectPlan() {},
    productForPlan: plan => products.find(p => APPLE_PRODUCTS[p.id] === plan),
  };
  apple.selectedProduct = products.find(p => p.id === apple.selected);
  const modules = {
    react: React, "react/jsx-runtime": jsx,
    "lucide-react": { Check: () => null, CircleCheck: () => null, Loader2: () => null },
    "next/image": { default: ({ priority, ...props }) => React.createElement("img", props) },
    "next/navigation": { useSearchParams: () => new URLSearchParams(), useRouter: () => ({ back() {}, push() {} }) },
    "@/lib/app-history": { cameFromAppPath: () => false, quietNextEntrance() {} },
    "@/lib/safe-router-prefetch": { safeRouterPrefetch() {} },
    "@/components/i18n-provider": { useT: () => t, useTranslations: () => ({ locale: "en", t }) },
    "@/components/msym": { Msym: () => null },
    "@/components/onboarding-flow": { OnboardingFlow: () => React.createElement("div", null, "onboarding") },
    "@/components/use-apple-billing": { useAppleBilling: () => apple },
    "@/components/apple-billing-terms": { AppleBillingTerms: () => React.createElement("div", null, "Apple renewal terms") },
    "@/components/memo-portal": { MemoPortal: ({ children }) => children },
    "@/components/use-sheet": { useSheet: () => ({ closing: false, dismiss() {}, dragProps: {} }), sheetClass: s => s },
    "@/lib/offer-resume": { clearOfferResume() {}, markOfferResume() {}, readOfferResume: () => ({ expiresAt: null }) },
    "@/lib/mobile/client": { useNativeIOS: () => native, nativeRequest() { throw new Error("No Apple calls during render"); } },
    "@/lib/mobile/products": { halfOffProducts: value => value },
    "@/lib/mobile/runtime": { APPLE_PRODUCTS },
    "@/lib/utils": { formatCurrency: value => `€${value.toFixed(2)}` },
    "@/lib/billing-regions": { STANDARD_PLAN_PRICES: { monthly: 20, yearly: 130 } },
    "@/lib/paywall-ladder": paywallLadder,
    "@/lib/paywall-offer-timing": { notePaywallShown() {}, paywallVisitCounted: () => false },
    "@/components/paywall-hero": {
      PaywallHero: ({ reason }) => React.createElement("div", { className: "memo-pw-hero", "data-reason": reason }),
      PaywallBrand: () => React.createElement("div", { className: "memo-pw-brand" }),
      PaywallMascot: () => React.createElement("span", { className: "memo-pw-memo" }),
      paywallLayout: reason => (reason ? "rows" : "cards"),
      paywallAccentStyle: () => undefined,
    },
    "@/components/onboarding-mascot": { MascotSparkles: () => null },
    "@/components/use-fit-screen": { useFitScreen() {}, fitScreenScript: () => "" },
    "@/lib/brand": { BRAND_LOCKUP_SRC: "/brand.png", BRAND_LOCKUP_WIDTH: 480, BRAND_LOCKUP_HEIGHT: 148, SEO_BRAND_NAME: "Memo" },
  };
  const context = { exports: {}, require: name => { assert.ok(name in modules, name); return modules[name]; }, URLSearchParams };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/components/${component}.tsx`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return context.exports;
}
function paywall(native, products, extra = {}) {
  const { OnboardingPaywall } = load("onboarding-paywall", native, products);
  return renderToStaticMarkup(React.createElement(OnboardingPaywall, {
    profile: null, subscription: null, onboardingComplete: true, hasPaidAccess: false, plans, ...extra,
  }));
}
const trial = [
  { id: "eu.memoai.premium.trial.monthly", price: "£19.00", monthlyPrice: "£19.00", trialDays: 3 },
  { id: "eu.memoai.premium.trial.yearly", price: "£124.99", monthlyPrice: "£10.42", yearlySavings: 45, trialDays: 3 },
];
test("iOS and PWA render the same paywall structure, benefits, cards and CTA", () => {
  const web = paywall(false, []);
  const ios = paywall(true, trial);
  for (const className of ["memo-pw-brand", "memo-paywall-title", "memo-paywall-benefits", "memo-paywall-plan-grid", "memo-paywall-plan-header", "memo-paywall-plan-price", "memo-paywall-cta", "memo-paywall-foot"]) {
    assert.ok(web.includes(className), className);
    assert.ok(ios.includes(className), className);
  }
  assert.doesNotMatch(ios, /memo-native-paywall|€130/);
  // The yearly card leads with its monthly equivalent and says underneath
  // what is billed each year.
  assert.match(ios, /memo-paywall-plan-price">£10.42<small>/);
  assert.match(ios, /3 days free, then billed yearly: £124.99/);
  assert.match(ios, /Nothing to pay today/);
});
test("an ineligible Apple account sees no promised trial or free checkout", () => {
  const html = paywall(true, trial.map(({ trialDays, ...product }) => product));
  assert.doesNotMatch(html, /Nothing to pay today|Start the 3-day free trial|3 days free/);
  assert.match(html, /Billed yearly: £124.99/);
  // The reassurance line under the plans names the App Store, never Stripe.
  assert.doesNotMatch(html, /Stripe/);
  assert.match(html, /Secure payment through the App Store/);
});
test("missing StoreKit products cannot show Stripe prices as Apple prices", () => {
  const html = paywall(true, []);
  assert.doesNotMatch(html, /€20|€130|Nothing to pay today|Stripe/);
  assert.match(html, /disabled=""/);
});
test("Apple wheel offer keeps the PWA sheet and uses actual first-period prices", () => {
  const offers = [
    { id: "eu.memoai.premium.monthly", price: "€19.99", introPrice: "€9.99", halfOff: true },
    { id: "eu.memoai.premium.yearly", price: "€129.99", introPrice: "€64.99", introWeeklyPrice: "€1.25", halfOff: true },
  ];
  const render = native => {
    const { DiscountOffer } = load("discount-offer", native, offers);
    return renderToStaticMarkup(React.createElement(DiscountOffer, {
      wheelOpen: false, offerOpen: true, nativeOffer: native,
      onWheelOpenChange() {}, onOfferOpenChange() {}, onClaimed() {},
    }));
  };
  const ios = render(true); const web = render(false);
  for (const className of ["memo-offer-sheet", "memo-offer-mascot", "memo-offer-headline", "memo-offer-plan-copy", "memo-offer-price", "memo-offer-cta"]) {
    assert.ok(ios.includes(className), className); assert.ok(web.includes(className), className);
  }
  assert.match(ios, /€64.99, then €129.99/);
  assert.match(ios, /€9.99/);
  // The yearly headline is weekly; the line beside it says what is billed yearly.
  assert.match(ios, /memo-offer-price">€1.25\/week</);
  assert.match(ios, /Billed yearly: €64.99, then €129.99/);
  assert.doesNotMatch(ios, /memo-native-paywall/);
  // The same sheet on both, countdown included: the app records its spin on
  // the same profile column, so the deadline it shows is the server's.
  assert.match(ios, /role="timer"/);
  assert.match(web, /role="timer"/);
  assert.match(ios, /Close the offer and it is gone/);
  assert.match(web, /Close the offer and it is gone/);
});

test("the code form's yearly card leads with the weekly price and says what is billed yearly", () => {
  const form = readFileSync(new URL("../src/components/apple-code-form.tsx", import.meta.url), "utf8");
  assert.match(form, /yearly && product\.introWeeklyPrice \?/);
  assert.match(form, /t\("offer\.plan\.oneOffPrice", \{ amount: product\.introWeeklyPrice \}\)/);
  assert.match(form, /t\("offer\.plan\.oneOffBilling", \{ discounted: product\.introPrice!, renewal: product\.price \}\)/);
});

test("the paywall after onboarding shows the year as a month, the discounted ones as a week", () => {
  const first = paywall(false, []);
  assert.match(first, /€10\.83<small>\/ month<\/small>/);
  assert.match(first, /Billed yearly: €130\.00/);
  assert.doesNotMatch(first, /\/ week/);

  const later = paywall(false, [], { reason: "chat", offerStep: 3 });
  assert.match(later, /€1\.75<small>\/ week<\/small>/);
});

test("a later paywall on the web offers the ladder's discount, and the app never does", () => {
  const web = paywall(false, [], { reason: "chat", offerStep: 3 });
  // The discount is the headline; first-payment-only is the small print.
  assert.match(web, /−30%<small>OFF<\/small>/);
  assert.match(web, /You save €39\.00/);
  assert.match(web, /class="memo-paywall-fine">The discount applies to your first payment only\./);
  assert.match(web, /€91\.00 for the first year, then €130\.00/);
  assert.match(web, /€14\.00 for the first month, then €20\.00/);
  assert.match(web, /<s class="memo-paywall-plan-was">€20\.00<\/s>/);
  // The trial comes with it while the account still has one.
  assert.match(web, /Try free, then 30% off/);
  assert.match(web, /Nothing to pay today/);
  const noTrial = paywall(false, [], { reason: "chat", offerStep: 3, subscriptionTrialEligible: false });
  assert.match(noTrial, /Get 30% off/);
  assert.doesNotMatch(noTrial, /Nothing to pay today|Try free/);
  assert.match(web, /memo-pw-hero" data-reason="chat"/);
  assert.doesNotMatch(web, /memo-paywall-benefits/);

  const ios = paywall(true, trial, { reason: "chat", offerStep: 3 });
  assert.doesNotMatch(ios, /% off|memo-paywall-plan-was|€/);
  assert.match(ios, /memo-pw-hero" data-reason="chat"/);
});
