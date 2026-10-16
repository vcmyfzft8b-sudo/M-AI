import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PAYWALL_LADDER,
  checkoutOffer,
  discountedAmount,
  paywallOffer,
  paywallOfferFor,
  reachedOffer,
  readSeenReasons,
  recordSeenReason,
  weeklyAmount,
  writeSeenReasons,
} from "../src/lib/paywall-ladder.ts";

/** Opens a paywall the way the app does: shown, then its moment recorded. */
function meet(seen, reason) {
  const shown = paywallOfferFor(reason, seen).percentOff;
  const after = reason ? recordSeenReason(seen, reason) : seen;
  assert.equal(reachedOffer(after).percentOff, shown, "the server's answer matches what was shown");
  return { shown, seen: after };
}

test("each rung offers more than the last, and never beats the wheel's 50%", () => {
  assert.deepEqual(PAYWALL_LADDER.map((offer) => offer.percentOff), [0, 20, 30, 40]);
  for (const offer of PAYWALL_LADDER) {
    assert.ok(offer.percentOff < 50);
    assert.equal(offer.coupon === null, offer.percentOff === 0);
  }
});

test("every paywall moment climbs a rung, limits and browsing offers alike, in any order", () => {
  for (const order of [
    ["chat", "listen", "tutor", "podcast"],
    ["offer", "offer", "offer", "offer"],
    ["offer", "chat", "offer", "note"],
    ["chat", "chat", "chat", "chat"],
  ]) {
    let seen = [];
    const percents = [];
    for (const reason of order) {
      const met = meet(seen, reason);
      percents.push(met.shown);
      seen = met.seen;
    }
    assert.deepEqual(percents, [20, 30, 40, 40], order.join(" → "));
  }
});

test("once at 40% nothing ever shows less, the chat paywall included", () => {
  let seen = [];
  for (const reason of ["offer", "chat", "listen"]) seen = meet(seen, reason).seen;
  for (const reason of ["chat", "offer", "note", null]) {
    assert.equal(meet(seen, reason).shown, 40, String(reason));
  }
});

test("the paywall nothing opened shows the rung reached, the plain price before any", () => {
  assert.equal(paywallOfferFor(null, []).percentOff, 0);
  assert.equal(paywallOfferFor(null, ["chat"]).percentOff, 20);
  assert.equal(paywallOfferFor(null, ["chat", "offer"]).percentOff, 30);
  assert.equal(paywallOfferFor(null, ["chat", "offer", "tutor"]).percentOff, 40);
});

test("checkout charges the rung shown, and never more than the cookie allows", () => {
  assert.equal(checkoutOffer(3, ["chat", "offer"]).percentOff, 30);
  assert.equal(checkoutOffer(4, ["chat"]).percentOff, 20, "a forged step is capped");
  assert.equal(checkoutOffer(2, ["chat", "offer", "tutor"]).percentOff, 20, "never more than was shown");
  assert.equal(checkoutOffer(null, ["chat", "offer"]).percentOff, 30);
  assert.equal(checkoutOffer(4, []).percentOff, 0, "no moment, no discount");
});

test("the stored moments keep known names, only as many as still lift the price", () => {
  assert.deepEqual(readSeenReasons(["chat", "bogus", "chat", "offer", "tutor", "note"]), ["chat", "chat", "offer"]);
  assert.deepEqual(readSeenReasons(null), []);
  assert.deepEqual(readSeenReasons([1, {}, "listen"]), ["listen"]);
  assert.deepEqual(readSeenReasons("chat.bogus.chat.offer.tutor.note"), ["chat", "chat", "offer"]);
  assert.deepEqual(readSeenReasons(""), []);
  assert.deepEqual(readSeenReasons(undefined), []);
  assert.equal(writeSeenReasons(["chat", "listen"]), "chat.listen");
  assert.deepEqual(recordSeenReason(["chat", "offer", "tutor"], "note"), ["chat", "offer", "tutor"]);
  assert.equal(paywallOffer(99).percentOff, 40);
});

test("prices: the discount to the cent, the year by the week rounded down", () => {
  assert.equal(discountedAmount(130, 20), 104);
  assert.equal(discountedAmount(130, 30), 91);
  assert.equal(discountedAmount(20, 40), 12);
  assert.equal(weeklyAmount(130), 2.5);
  assert.equal(weeklyAmount(91), 1.75);
  assert.equal(weeklyAmount(78), 1.5);
  assert.equal(weeklyAmount(65), 1.25, "the wheel's own figure");
});

test("a ladder discount comes with the trial, on a coupon that reaches the first payment; the wheel has no trial", () => {
  const route = readFileSync(new URL("../src/app/api/billing/checkout/route.ts", import.meta.url), "utf8");
  assert.match(route, /checkoutOffer\(parsed\.data\.step \?\? null, await readPaywallMoments\(appState\.user\.id\)\)/);
  assert.match(route, /appState\.subscriptionTrialEligible && !hasPriorStripeSubscription && !wheelCoupon;/);
  assert.match(route, /wheelCoupon \?\? \(subscriptionTrialEligible \? ladderOffer\.trialCoupon : ladderOffer\.coupon\)/);
  assert.match(route, /\.\.\.\(coupon\s*\? \{ discounts: \[\{ coupon \}\] \}\s*: \{ allow_promotion_codes: true \}\)/);
  for (const offer of PAYWALL_LADDER) {
    assert.equal(offer.trialCoupon === null, offer.coupon === null);
    if (offer.trialCoupon) assert.equal(offer.trialCoupon, `memo${offer.percentOff}-after-trial`);
  }
});

test("the app never moves up the ladder", () => {
  const view = readFileSync(new URL("../src/app/api/billing/paywall-view/route.ts", import.meta.url), "utf8");
  assert.match(view, /if \(isNativeUserAgent\(request\.headers\.get\("user-agent"\)\)\) \{\s*return NextResponse\.json\(\{ seen: \[\], advanced: false, step: 1 \}\);/);
  const page = readFileSync(new URL("../src/app/app/start/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const offerStep = native \? 1 :/);
});

test("the ladder belongs to the account, never to the device", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const view = read("../src/app/api/billing/paywall-view/route.ts");
  assert.match(view, /recordPaywallMoment\(user\.id, parsed\.data\.reason, parsed\.data\.counted === true\)/);
  assert.match(view, /response\.cookies\.delete\(LEGACY_PAYWALL_COOKIE\)/);
  assert.match(read("../src/app/app/start/page.tsx"), /await readPaywallMoments\(appState\.user\.id\)/);
  const moments = read("../src/lib/paywall-moments.ts");
  assert.match(moments, /\.select\("paywall_moments"\)\s*\.eq\("id", userId\)/);
  assert.match(moments, /\.update\(\{ paywall_moments: after \} as never\)\s*\.eq\("id", userId\)/);
  // Nothing reads the old device-wide cookie any more.
  for (const path of ["../src/app/api/billing/checkout/route.ts", "../src/app/app/start/page.tsx", view && "../src/app/api/billing/paywall-view/route.ts"]) {
    assert.doesNotMatch(read(path), /cookies\(\)\)?\.get\(/, path);
  }
  const migration = read("../supabase/migrations/0064_paywall_moments.sql");
  assert.match(migration, /add column if not exists paywall_moments text\[\] not null default '\{\}'/);
});

test("two accounts on one device climb their own ladders", () => {
  // The server keeps one list per account; the device holds none.
  const store = new Map();
  const visit = (user, reason) => {
    const before = store.get(user) ?? [];
    const shown = paywallOfferFor(reason, before).percentOff;
    store.set(user, recordSeenReason(before, reason));
    return shown;
  };
  assert.deepEqual(["chat", "offer", "listen"].map((r) => visit("ana", r)), [20, 30, 40]);
  assert.equal(visit("bor", "chat"), 20, "a second account on the same phone starts at the first rung");
  assert.equal(paywallOfferFor(null, store.get("bor")).percentOff, 20);
  assert.equal(paywallOfferFor(null, store.get("ana")).percentOff, 40, "and the first keeps its own");
});
