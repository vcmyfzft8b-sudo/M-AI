import test from "node:test";
import assert from "node:assert/strict";
import { HALF_OFF_OFFERS, offerRequest, verifyOffer } from "../scripts/apple/half-off-offers.mjs";

function fixture(config = HALF_OFF_OFFERS[0]) {
  const territories = ["SVN", "USA", "HRV"];
  return { config, subscription: { id: config.subscriptionId, attributes: {
    productId: config.productId, subscriptionPeriod: config.duration,
  } }, territories, intro: {
    data: territories.map(id => ({ attributes: { startDate: "2026-09-01", endDate: null,
      duration: config.duration, offerMode: "PAY_UP_FRONT", numberOfPeriods: 1, targetSubscriptionPlanType: "UPFRONT" },
      relationships: { territory: { data: { type: "territories", id } },
        subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: `point-${id}` } } } })),
    included: territories.map(id => ({ type: "subscriptionPricePoints", id: `point-${id}`, attributes: { customerPrice: config.price } })),
  } };
}
const build = f => offerRequest(f.config, f.subscription, f.intro, f.territories, "2026-09-23");

for (const config of HALF_OFF_OFFERS) test(`${config.duration} reuses Apple price points and creates one paid first period`, () => {
  const f = fixture(config), result = build(f);
  assert.equal(result.data.attributes.offerMode, "PAY_UP_FRONT");
  assert.equal(result.data.attributes.numberOfPeriods, 1);
  assert.equal(result.data.attributes.duration, config.duration);
  assert.equal(result.included.length, 3);
  assert.equal(result.included[0].id, "${price-0}");
  assert.deepEqual(result.data.relationships.prices.data, result.included.map(({type,id}) => ({type,id})));
  assert.deepEqual(result.included.map(p => p.relationships.subscriptionPricePoint.data.id), ["point-SVN", "point-USA", "point-HRV"]);
  verifyOffer(config, { attributes: result.data.attributes }, [...result.included].reverse(), result);
});

test("setup refuses a trial, different product, price, period or incomplete storefront coverage", () => {
  for (const mutate of [
    f => { f.subscription.attributes.productId = "eu.memoai.premium.trial.monthly"; },
    f => { f.intro.data[0].attributes.offerMode = "FREE_TRIAL"; },
    f => { f.intro.data[0].attributes.numberOfPeriods = 2; },
    f => { f.intro.data[0].attributes.duration = "ONE_YEAR"; },
    f => { f.intro.included[0].attributes.customerPrice = "10.00"; },
    f => { f.intro.included.pop(); },
    f => { f.intro.data.pop(); },
    f => { f.intro.data.push(structuredClone(f.intro.data[0])); },
    f => { f.intro.data[0].attributes.startDate = "2027-01-01"; },
    f => { f.intro.data[0].attributes.endDate = "2026-09-22"; },
  ]) {
    const f = fixture(); mutate(f); assert.throws(() => build(f));
  }
});

test("fresh verification detects a changed price, missing territory or altered renewal duration", () => {
  const f = fixture(), result = build(f);
  assert.throws(() => verifyOffer(f.config, {attributes:{...result.data.attributes,duration:"ONE_YEAR"}},result.included,result));
  assert.throws(() => verifyOffer(f.config, {attributes:result.data.attributes},result.included.slice(1),result));
  const wrongPrice = structuredClone(result.included);
  wrongPrice[0].relationships.subscriptionPricePoint.data.id = "other-point";
  assert.throws(() => verifyOffer(f.config, {attributes:result.data.attributes},wrongPrice,result));
});
