import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OFFER_AFTER_SCREENS,
  OFFER_GAP_MS,
  OFFER_QUIET_MS,
  offerIsDue,
} from "../src/lib/paywall-offer-timing.ts";

const now = 10 * 24 * 60 * 60 * 1000;
const long = { now, screens: OFFER_AFTER_SCREENS, lastPaywall: 0, lastOffer: 0 };

test("a browsing offer waits for a few screens, a quiet spell after any paywall, and the gap since the last offer", () => {
  assert.equal(offerIsDue(long), true);
  assert.equal(offerIsDue({ ...long, screens: OFFER_AFTER_SCREENS - 1 }), false);
  assert.equal(offerIsDue({ ...long, lastPaywall: now - OFFER_QUIET_MS + 1 }), false);
  assert.equal(offerIsDue({ ...long, lastPaywall: now - OFFER_QUIET_MS }), true);
  assert.equal(offerIsDue({ ...long, lastOffer: now - OFFER_GAP_MS + 1 }), false);
  assert.equal(offerIsDue({ ...long, lastOffer: now - OFFER_GAP_MS }), true);
});

test("the browsing offer runs on the web only, for an onboarded learner who has not paid, and only on the home screen", () => {
  const layout = readFileSync(new URL("../src/app/app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /\{!native && appState\?\.onboardingComplete && !appState\.hasPaidAccess \? <PaywallNudge \/> : null\}/);

  const nudge = readFileSync(new URL("../src/components/paywall-nudge.tsx", import.meta.url), "utf8");
  assert.match(nudge, /pathname === "\/app" &&/);
  assert.match(nudge, /NOT_BROWSING = \["\/app\/start", "\/app\/new", "\/app\/settings", "\/app\/support", "\/app\/consent"\]/);
  // Recorded on the server before it opens; the price is never decided here.
  assert.match(nudge, /body: JSON\.stringify\(\{ reason: "offer" \}\)/);
});

test("every paywall restarts the quiet spell, and only feature paywalls record a limit", () => {
  const paywall = readFileSync(new URL("../src/components/onboarding-paywall.tsx", import.meta.url), "utf8");
  assert.match(paywall, /notePaywallShown\(\);\s*if \(!reason \|\| reason === "offer"\) \{\s*return;/);
});
