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
  assert.match(layout, /\{!native && appState\?\.onboardingComplete && !appState\.hasPaidAccess \? <PaywallNudge userId=\{user\.id\} \/> : null\}/);

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

test("a reload or a return through history is the same paywall visit; opening it again later is a new one", async () => {
  const store = new Map();
  globalThis.window = {
    location: { pathname: "/app/start", search: "?for=chat" },
    history: { length: 4 },
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
  };
  const { paywallVisitCounted } = await import("../src/lib/paywall-offer-timing.ts?visits");
  assert.equal(paywallVisitCounted(), false, "first visit counts");
  assert.equal(paywallVisitCounted(), true, "a reload does not");
  window.history.length = 6;
  assert.equal(paywallVisitCounted(), false, "the same paywall opened again later counts");
  delete globalThis.window;
});

test("a drag, or a tap that closes a row's actions, never opens the offer", () => {
  const nudge = readFileSync(new URL("../src/components/paywall-nudge.tsx", import.meta.url), "utf8");
  assert.match(nudge, /Math\.hypot\(event\.clientX - pressedAt\.x, event\.clientY - pressedAt\.y\) > DRAG_PX/);
  assert.match(nudge, /target\.closest\("\.memo-swipe-row\.open"\)/);
});

test("the new-note sheet's paywall closes to home (or the page that opened it), never to the sheet", () => {
  const modal = readFileSync(new URL("../src/components/note-source-modal.tsx", import.meta.url), "utf8");
  assert.match(modal, /paywallBack = "\/app",/);
  assert.match(modal, /replacingNextPage\(\);\s*router\.replace\(paywallPath\("note", paywallBack\)\);/);
  assert.match(modal, /navigateWithFeedback\(paywallPath\("note", paywallBack\)\);/);
  // Exam setup is a page of its own, not the sheet, so its paywall returns there.
  const setup = readFileSync(new URL("../src/components/exams/exam-setup.tsx", import.meta.url), "utf8");
  assert.match(setup, /paywallBack="\/app\/exams\/new"/);
  const moments = readFileSync(new URL("../src/lib/paywall-moments.ts", import.meta.url), "utf8");
  assert.match(moments, /const after = alreadyCounted \? before : recordSeenReason\(before, reason\);/);
});

test("another account on the same tab starts its own count", async () => {
  const store = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  const { countOfferScreen, noteOfferAccount, OFFER_SCREENS_KEY } = await import("../src/lib/paywall-offer-timing.ts?accounts");
  noteOfferAccount("ana");
  countOfferScreen(); countOfferScreen(); countOfferScreen();
  assert.equal(store.get(OFFER_SCREENS_KEY), "3");
  noteOfferAccount("ana");
  assert.equal(store.get(OFFER_SCREENS_KEY), "3", "the same account keeps counting");
  noteOfferAccount("bor");
  assert.equal(store.get(OFFER_SCREENS_KEY), undefined, "a new account starts from nothing");
  assert.equal(countOfferScreen(), false);
  delete globalThis.window;
});
