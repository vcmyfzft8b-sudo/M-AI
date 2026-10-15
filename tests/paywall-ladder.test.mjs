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

test("the cookie keeps known moments, only as many as still lift the price", () => {
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

test("a discounted checkout has no trial and no promo-code field; the wheel wins", () => {
  const route = readFileSync(new URL("../src/app/api/billing/checkout/route.ts", import.meta.url), "utf8");
  assert.match(route, /checkoutOffer\(\s*parsed\.data\.step \?\? null,\s*readSeenReasons\(\(await cookies\(\)\)\.get\(PAYWALL_SEEN_COOKIE\)\?\.value\),/);
  assert.match(route, /const coupon = wheelCoupon \?\? ladderOffer\.coupon;/);
  assert.match(route, /!hasPriorStripeSubscription && !coupon;/);
  assert.match(route, /\.\.\.\(coupon\s*\? \{ discounts: \[\{ coupon \}\] \}\s*: \{ allow_promotion_codes: true \}\)/);
});

test("the app never moves up the ladder", () => {
  const view = readFileSync(new URL("../src/app/api/billing/paywall-view/route.ts", import.meta.url), "utf8");
  assert.match(view, /if \(isNativeUserAgent\(request\.headers\.get\("user-agent"\)\)\) \{\s*return NextResponse\.json\(\{ seen: \[\], advanced: false, step: 1 \}\);/);
  const page = readFileSync(new URL("../src/app/app/start/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const offerStep = native \? 1 :/);
});
