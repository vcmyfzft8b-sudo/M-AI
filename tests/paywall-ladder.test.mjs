import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PAYWALL_LADDER,
  advancePaywallStep,
  checkoutPaywallOffer,
  discountedAmount,
  nextPaywallStep,
  paywallOffer,
  readPaywallStep,
} from "../src/lib/paywall-ladder.ts";

test("each paywall offers more than the last, and never beats the wheel's 50%", () => {
  assert.deepEqual(PAYWALL_LADDER.map((offer) => offer.percentOff), [0, 20, 30, 40]);
  for (const offer of PAYWALL_LADDER) {
    assert.ok(offer.percentOff < 50);
    assert.equal(offer.coupon === null, offer.percentOff === 0);
  }
  assert.equal(nextPaywallStep(0), 1);
  assert.equal(nextPaywallStep(1), 2);
  assert.equal(nextPaywallStep(4), 4);
});

test("the cookie moves one step per paywall shown, never backwards and never further", () => {
  assert.equal(advancePaywallStep(0, 1), 1);
  assert.equal(advancePaywallStep(1, 2), 2);
  assert.equal(advancePaywallStep(1, 4), 2, "a claimed jump is cut to one step");
  assert.equal(advancePaywallStep(3, 1), 3, "an old paywall does not move it back");
  assert.equal(advancePaywallStep(4, 4), 4);
  assert.equal(readPaywallStep("9"), 4);
  assert.equal(readPaywallStep("-3"), 0);
  assert.equal(readPaywallStep("nonsense"), 0);
});

test("checkout applies the shown step, capped by the cookie", () => {
  assert.equal(checkoutPaywallOffer(3, 3).coupon, "memo30-first-cycle");
  assert.equal(checkoutPaywallOffer(4, 2).coupon, "memo20-first-cycle", "a forged step is capped");
  assert.equal(checkoutPaywallOffer(undefined, 4).coupon, null, "no step: the plain price");
  assert.equal(checkoutPaywallOffer(2, 0).coupon, null, "no paywall seen yet: the plain price");
  assert.equal(paywallOffer(99).percentOff, 40);
});

test("discounted prices are the regular price less the percentage, to the cent", () => {
  assert.equal(discountedAmount(130, 20), 104);
  assert.equal(discountedAmount(130, 30), 91);
  assert.equal(discountedAmount(20, 40), 12);
  assert.equal(discountedAmount(130 / 12, 30), 7.58);
});

test("checkout takes the coupon from the ladder, lets the wheel win, and drops the trial", () => {
  const route = readFileSync(new URL("../src/app/api/billing/checkout/route.ts", import.meta.url), "utf8");
  assert.match(route, /const coupon = wheelCoupon \?\? ladderOffer\.coupon;/);
  assert.match(route, /!hasPriorStripeSubscription && !coupon;/);
  assert.match(route, /\{ discounts: \[\{ coupon \}\] \}/);
});

test("the app never moves down the ladder", () => {
  const view = readFileSync(new URL("../src/app/api/billing/paywall-view/route.ts", import.meta.url), "utf8");
  assert.match(view, /if \(isNativeUserAgent\(request\.headers\.get\("user-agent"\)\)\) \{\s*return NextResponse\.json\(\{ step: 1 \}\);/);
  const page = readFileSync(new URL("../src/app/app/start/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const offerStep = native\s*\? 1/);
});
