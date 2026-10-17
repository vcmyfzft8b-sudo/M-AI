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

import * as paywallReasons from "../src/lib/paywall-reasons.ts";

const t = createTranslator("en", [en]);

function load(native) {
  const modules = {
    react: React, "react/jsx-runtime": jsx,
    // The meter is portalled into the note's header; rendering it in place is enough here.
    "react-dom": { createPortal: node => node },
    "@/lib/mobile/client": { useNativeIOS: () => native, nativeRequest() { throw new Error("No Apple calls during render"); } },
    "@/lib/mobile/billing-notice": { nativeBillingFailureKey: () => "native.verifyFailed" },
    "next/navigation": { usePathname: () => "/app/lectures/abc" },
    "@/components/creator-demo/creator-demo-context": { useAppHref: href => href },
    "@/lib/paywall-reasons": paywallReasons,
    "@/components/instant-link": { InstantLink: ({ children, href, className }) => React.createElement("a", { href, className }, children) },
    "@/components/i18n-provider": { useT: () => t },
    "@/components/memo-portal": { MemoPortal: ({ children }) => children },
    "@/components/msym": { Msym: () => null },
    "@/components/paywall-notebook": { HAND_FONT: { variable: "hand" }, Marked: ({ text }) => text.replaceAll("*", "") },
    "@/components/use-sheet": { useSheet: () => ({ closing: false, dismiss() {}, dragProps: {} }), sheetClass: s => s },
  };
  const context = { exports: {}, require: name => { assert.ok(name in modules, name); return modules[name]; } };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/voice-usage-sheet.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return context.exports.VoiceUsageSheet;
}

const usage = (overrides) => ({
  feature: "tutor", remainingSeconds: 1200, limitSeconds: 1800, usedSeconds: 600,
  creditSeconds: 0, hasPaidAccess: true, hasUnlimitedUsage: false, ...overrides,
});
const render = (value, native = false) => renderToStaticMarkup(React.createElement(load(native), {
  usage: value, slot: {}, onBuyCredits() {},
}));

test("a subscriber with time left is offered a top-up, worded for time left", () => {
  const html = render(usage());
  assert.match(html, /Need more time\?/);
  assert.match(html, /Top up an hour for €2/);
  assert.doesNotMatch(html, /That&#x27;s your tutor time for today/);
});

test("a subscriber who has run out keeps the out-of-time offer", () => {
  const html = render(usage({ remainingSeconds: 0, usedSeconds: 1800 }));
  assert.match(html, /That&#x27;s your tutor time for today/);
  assert.match(html, /Top up an hour for €2/);
  assert.doesNotMatch(html, /Need more time\?/);
});

test("free and unlimited accounts are not offered a top-up while they have time", () => {
  const free = render(usage({ hasPaidAccess: false, remainingSeconds: 30, limitSeconds: 60, usedSeconds: 30 }));
  assert.doesNotMatch(free, /Top up an hour|Need more time/);
  const unlimited = render(usage({ hasUnlimitedUsage: true }));
  assert.doesNotMatch(unlimited, /Top up an hour|Need more time/);
});

test("the app never shows the Stripe top-up, and waits for Apple's price", () => {
  // Apple's price arrives after mount; until then the app shows no offer at all.
  const html = render(usage(), true);
  assert.doesNotMatch(html, /Top up an hour for €2|Need more time/);
});

test("a refused tutor start opens the tutor-time sheet instead of seeming to do nothing", () => {
  const sheet = readFileSync(new URL("../src/components/voice-usage-sheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /if \(openSignal > 0 && menuRef\.current && !menuRef\.current\.open\) \{\s*menuRef\.current\.open = true;/);
  const tutor = readFileSync(new URL("../src/components/lecture-tutor.tsx", import.meta.url), "utf8");
  // Every refusal for want of time bumps the signal, at start and mid-session alike.
  const refusals = tutor.match(/setBlocked\((payload|refusal)\?\.code \?\? "tutor_credits_needed"\);\s*setBlockSignal\(\(count\) => count \+ 1\);/g) ?? [];
  assert.equal(refusals.length, 3);
  assert.equal((tutor.match(/setBlocked\((payload|refusal)\?\.code/g) ?? []).length, 3);
  assert.match(tutor, /openSignal=\{blockSignal\}/);
});

test("without a subscription, the offer goes straight to the paywall", () => {
  const html = render(usage({ hasPaidAccess: false, remainingSeconds: 0, limitSeconds: 60, usedSeconds: 60 }));
  assert.match(html, /Your free minute is used up/);
  assert.match(html, /Memo Pro gives you time every day/);
  // The paywall that names the tutor, closing back to the note it was opened on.
  assert.match(html, /href="\/app\/start\?for=tutor&amp;back=%2Fapp%2Flectures%2Fabc"[^>]*>Get more time every day/);
  assert.doesNotMatch(html, /href="\/app\/settings"/);
});
