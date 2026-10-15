import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { OFFER_EVERY_SCREENS, offerIsDue } from "../src/lib/paywall-offer-timing.ts";

test("a browsing offer opens on every fourth click without a paywall", () => {
  assert.equal(OFFER_EVERY_SCREENS, 4);
  assert.equal(offerIsDue(OFFER_EVERY_SCREENS - 1), false);
  assert.equal(offerIsDue(OFFER_EVERY_SCREENS), true);
});

test("the browsing offer runs on the web only, for an onboarded learner who has not paid", () => {
  const layout = readFileSync(new URL("../src/app/app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /\{!native && appState\?\.onboardingComplete && !appState\.hasPaidAccess \? <PaywallNudge \/> : null\}/);

  const nudge = readFileSync(new URL("../src/components/paywall-nudge.tsx", import.meta.url), "utf8");
  // Never in a recording, settings or support.
  assert.match(nudge, /NOT_BROWSING = \["\/app\/start", "\/app\/new", "\/app\/settings", "\/app\/support", "\/app\/consent"\]/);
});

test("every paywall restarts the count, and records its moment once before checkout", () => {
  const paywall = readFileSync(new URL("../src/components/onboarding-paywall.tsx", import.meta.url), "utf8");
  assert.match(paywall, /notePaywallShown\(\);\s*if \(!reason \|\| viewRequest\.current\?\.key === viewKey\) \{\s*return;/);
  assert.match(paywall, /await viewRequest\.current\?\.done;\s*const response = await fetch\("\/api\/billing\/checkout"/);
  assert.match(paywall, /body: JSON\.stringify\(\{ plan, reason, step: offer\.step \}\)/);
});

test("only a click opens the browsing offer, in place of what it would have opened", () => {
  const nudge = readFileSync(new URL("../src/components/paywall-nudge.tsx", import.meta.url), "utf8");
  assert.match(nudge, /const OPENS = 'a\[href\], \[role="link"\], \.memo-tabs button';/);
  assert.match(nudge, /return target\.getAttribute\("aria-current"\) !== "page";/);
  assert.match(nudge, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(nudge, /document\.addEventListener\("click", onClick, true\)/);
  // Arriving on a page, going back or reloading counts for nothing.
  assert.doesNotMatch(nudge, /usePathname\(\)[\s\S]*if \(countOfferScreen\(\)\) \{\s*openOffer/);
});
