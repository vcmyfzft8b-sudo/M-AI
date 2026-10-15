import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { OFFER_EVERY_SCREENS, offerIsDue } from "../src/lib/paywall-offer-timing.ts";

test("a browsing offer opens after every few screens without a paywall", () => {
  assert.equal(OFFER_EVERY_SCREENS, 4);
  assert.equal(offerIsDue(OFFER_EVERY_SCREENS - 1), false);
  assert.equal(offerIsDue(OFFER_EVERY_SCREENS), true);
});

test("the browsing offer runs on the web only, for an onboarded learner who has not paid", () => {
  const layout = readFileSync(new URL("../src/app/app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /\{!native && appState\?\.onboardingComplete && !appState\.hasPaidAccess \? <PaywallNudge \/> : null\}/);

  const nudge = readFileSync(new URL("../src/components/paywall-nudge.tsx", import.meta.url), "utf8");
  // Pages and note tabs count; a recording, settings and support never do.
  assert.match(nudge, /NOT_BROWSING = \["\/app\/start", "\/app\/new", "\/app\/settings", "\/app\/support", "\/app\/consent"\]/);
  assert.match(nudge, /const NOTE_TAB = "\.memo-tabs button";/);
  assert.match(nudge, /tab\.getAttribute\("aria-current"\) === "page"/);
  assert.match(nudge, /document\.addEventListener\("click", onClick, true\)/);
});

test("every paywall restarts the count, and records its moment once before checkout", () => {
  const paywall = readFileSync(new URL("../src/components/onboarding-paywall.tsx", import.meta.url), "utf8");
  assert.match(paywall, /notePaywallShown\(\);\s*if \(!reason \|\| viewRequest\.current\?\.key === viewKey\) \{\s*return;/);
  assert.match(paywall, /await viewRequest\.current\?\.done;\s*const response = await fetch\("\/api\/billing\/checkout"/);
  assert.match(paywall, /body: JSON\.stringify\(\{ plan, reason, step: offer\.step \}\)/);
});
