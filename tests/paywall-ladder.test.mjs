import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PAYWALL_LADDER,
  discountedAmount,
  paywallOffer,
  paywallOfferFor,
  readSeenReasons,
  recordSeenReason,
  weeklyAmount,
  writeSeenReasons,
} from "../src/lib/paywall-ladder.ts";

test("each feature limit offers more than the last, and never beats the wheel's 50%", () => {
  assert.deepEqual(PAYWALL_LADDER.map((offer) => offer.percentOff), [0, 20, 30, 40]);
  for (const offer of PAYWALL_LADDER) {
    assert.ok(offer.percentOff < 50);
    assert.equal(offer.coupon === null, offer.percentOff === 0);
  }
});

test("the first limit met gives 20%, the second 30%, the third and later 40%, in any order", () => {
  for (const order of [
    ["chat", "listen", "tutor", "podcast"],
    ["note", "library", "chat", "locked"],
    ["podcast", "regenerate", "listen", "note"],
  ]) {
    let seen = [];
    const percents = [];
    for (const reason of order) {
      percents.push(paywallOfferFor(reason, seen).percentOff);
      seen = recordSeenReason(seen, reason);
    }
    assert.deepEqual(percents, [20, 30, 40, 40], order.join(" → "));
  }
});

test("a feature keeps the discount it was first given", () => {
  const seen = ["chat", "listen", "tutor"];
  assert.equal(paywallOfferFor("chat", seen).percentOff, 20);
  assert.equal(paywallOfferFor("listen", seen).percentOff, 30);
  assert.equal(paywallOfferFor("tutor", seen).percentOff, 40);
  assert.deepEqual(recordSeenReason(seen, "chat"), seen, "meeting it again changes nothing");
});

test("a paywall no feature opened shows the plain price, then the best rung reached", () => {
  assert.equal(paywallOfferFor(null, []).percentOff, 0);
  assert.equal(paywallOfferFor(null, ["chat"]).percentOff, 20);
  assert.equal(paywallOfferFor(null, ["chat", "listen"]).percentOff, 30);
  assert.equal(paywallOfferFor(null, ["chat", "listen", "tutor", "note"]).percentOff, 40);
});

test("the cookie only keeps known features, once each, in order", () => {
  assert.deepEqual(readSeenReasons("chat.listen.chat.bogus.tutor"), ["chat", "listen", "tutor"]);
  assert.deepEqual(readSeenReasons(""), []);
  assert.deepEqual(readSeenReasons(undefined), []);
  assert.equal(writeSeenReasons(["chat", "listen"]), "chat.listen");
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

test("checkout reads the discount from the cookie, lets the wheel win, and drops the trial", () => {
  const route = readFileSync(new URL("../src/app/api/billing/checkout/route.ts", import.meta.url), "utf8");
  assert.match(route, /paywallOfferFor\(\s*parsed\.data\.reason \?\? null,\s*readSeenReasons\(\(await cookies\(\)\)\.get\(PAYWALL_SEEN_COOKIE\)\?\.value\),/);
  assert.match(route, /const coupon = wheelCoupon \?\? ladderOffer\.coupon;/);
  assert.match(route, /!hasPriorStripeSubscription && !coupon;/);
  assert.match(route, /\{ discounts: \[\{ coupon \}\] \}/);
});

test("the app never moves down the ladder", () => {
  const view = readFileSync(new URL("../src/app/api/billing/paywall-view/route.ts", import.meta.url), "utf8");
  assert.match(view, /if \(isNativeUserAgent\(request\.headers\.get\("user-agent"\)\)\) \{\s*return NextResponse\.json\(\{ seen: \[\] \}\);/);
  const page = readFileSync(new URL("../src/app/app/start/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const offerStep = native\s*\? 1/);
});
