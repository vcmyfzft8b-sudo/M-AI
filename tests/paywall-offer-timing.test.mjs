import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { OFFER_EVERY_SCREENS, offerIsDue } from "../src/lib/paywall-offer-timing.ts";

test("a browsing offer opens on every seventh tap without a paywall", () => {
  assert.equal(OFFER_EVERY_SCREENS, 7);
  assert.equal(offerIsDue(OFFER_EVERY_SCREENS - 1), false);
  assert.equal(offerIsDue(OFFER_EVERY_SCREENS), true);
});

test("the browsing offer runs on the web only, for an onboarded learner who has not paid", () => {
  const layout = readFileSync(new URL("../src/app/app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /\{!native && appState\?\.onboardingComplete && !appState\.hasPaidAccess \? <PaywallNudge userId=\{user\.id\} \/> : null\}/);

  const nudge = readFileSync(new URL("../src/components/paywall-nudge.tsx", import.meta.url), "utf8");
  // Every screen counts, settings and support included; only the paywall itself and consent do not.
  assert.match(nudge, /NOT_BROWSING = \["\/app\/start", "\/app\/consent"\]/);
});

test("every paywall restarts the count, and records its moment once before checkout", () => {
  const paywall = readFileSync(new URL("../src/components/onboarding-paywall.tsx", import.meta.url), "utf8");
  assert.match(paywall, /notePaywallShown\(\);\s*if \(!reason \|\| viewRequest\.current\?\.key === viewKey\) \{\s*return;/);
  assert.match(paywall, /await viewRequest\.current\?\.done;\s*const response = await fetch\("\/api\/billing\/checkout"/);
  assert.match(paywall, /body: JSON\.stringify\(\{ plan, reason, step: offer\.step \}\)/);
});

test("every tap on anything pressable counts, and the seventh opens the offer in its place", () => {
  const nudge = readFileSync(new URL("../src/components/paywall-nudge.tsx", import.meta.url), "utf8");
  const tappable = nudge.match(/const TAPPABLE = \[([\s\S]*?)\]\.join/)[1];
  for (const selector of ["a[href]", "button", '[role="button"]', '[role="link"]', '[role="tab"]', '[role="switch"]', 'input[type="checkbox"]']) {
    assert.ok(tappable.includes(selector), selector);
  }
  // Typing is not a tap, and a label would count its control's one tap twice.
  assert.doesNotMatch(tappable, /"label"|textarea|input\[type="text"\]/);
  assert.match(nudge, /event\.target\.closest\(TAPPABLE\)/);
  // Enter sending the chat, or a key pressing a button, is not a tap.
  assert.match(nudge, /if \(event\.detail === 0 \|\| event\.button !== 0/);
  assert.match(nudge, /target\.matches\(":disabled, \[aria-disabled='true'\]"\)/);
  assert.doesNotMatch(nudge, /opensSomething|aria-current/);
  assert.match(nudge, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(nudge, /document\.addEventListener\("click", onClick, true\)/);
  // Arriving on a page, going back or reloading counts for nothing.
  assert.doesNotMatch(nudge, /usePathname\(\)[\s\S]*if \(countOfferScreen\(\)\) \{\s*openOffer/);
});

test("nothing counts or opens while a recording, an upload or a tutor session is live, or inside an offer", () => {
  const nudge = readFileSync(new URL("../src/components/paywall-nudge.tsx", import.meta.url), "utf8");
  assert.match(nudge, /const NEVER_HERE = "\[data-offer-hold\], \.memo-wheel-sheet, \.memo-offer-sheet, \.memo-paywall-shell";/);
  assert.match(nudge, /target\.closest\(NEVER_HERE\) \|\|\s*\/\/[^\n]*\n\s*document\.querySelector\("\[data-offer-hold\]"\) \|\|\s*!countOfferScreen\(\)/);
  const modal = readFileSync(new URL("../src/components/note-source-modal.tsx", import.meta.url), "utf8");
  assert.match(modal, /data-offer-hold=\{isRecording \|\| isStarting \|\| busyLabel \? "" : undefined\}/);
  const tutor = readFileSync(new URL("../src/components/lecture-tutor.tsx", import.meta.url), "utf8");
  assert.match(tutor, /data-offer-hold=\{phase === "idle" \? undefined : ""\}/);
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

test("the new-note sheet's paywall closes to home, never to the sheet that sent it", () => {
  const modal = readFileSync(new URL("../src/components/note-source-modal.tsx", import.meta.url), "utf8");
  assert.match(modal, /replacingNextPage\(\);\s*router\.replace\(paywallPath\("note", "\/app"\)\);/);
  assert.match(modal, /navigateWithFeedback\(paywallPath\("note", "\/app"\)\);/);
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

test("one tap opens one offer, however slowly it arrives", () => {
  const nudge = readFileSync(new URL("../src/components/paywall-nudge.tsx", import.meta.url), "utf8");
  assert.match(nudge, /if \(\s*opening \|\|/);
  assert.match(nudge, /opening = true;\s*router\.push\(/);
});

test("taps one to six go through, the seventh opens the offer, and a paywall starts the count again", async () => {
  const store = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  const { countOfferScreen, notePaywallShown } = await import("../src/lib/paywall-offer-timing.ts?seventh");
  const round = () => Array.from({ length: 7 }, () => countOfferScreen());
  assert.deepEqual(round(), [false, false, false, false, false, false, true]);
  notePaywallShown();
  assert.deepEqual(round(), [false, false, false, false, false, false, true], "after the offer, seven more");
  notePaywallShown();
  countOfferScreen(); countOfferScreen();
  notePaywallShown(); // a limit's paywall in between
  assert.deepEqual(round(), [false, false, false, false, false, false, true], "any paywall starts it again");
  delete globalThis.window;
});
