#!/usr/bin/env node
/**
 * Prepare the Apple promotional prices used by validated first-cycle codes.
 * Read-only by default; --apply creates missing offers and verifies a fresh read.
 * Never modifies an existing offer, base price, introductory offer or trial.
 *
 * node scripts/apple/half-off-offers.mjs [--apply]
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { SignJWT, importPKCS8 } from "jose";

export const HALF_OFF_OFFERS = [
  { subscriptionId: "6812410886", productId: "eu.memoai.premium.monthly", duration: "ONE_MONTH", offerCode: "memo_code_half_month", name: "Memo code first month", price: "9.99" },
  { subscriptionId: "6812422840", productId: "eu.memoai.premium.yearly", duration: "ONE_YEAR", offerCode: "memo_code_half_year", name: "Memo code first year", price: "64.99" },
];

/** Copy Apple's existing territory-specific introductory price points exactly. */
export function offerRequest(config, subscription, intro, availableTerritories, today) {
  if (!/^[a-zA-Z0-9_.]+$/.test(config.offerCode)) throw new Error("Invalid Apple offer identifier");
  if (subscription.id !== config.subscriptionId || subscription.attributes.productId !== config.productId ||
      subscription.attributes.subscriptionPeriod !== config.duration) throw new Error("Subscription identity mismatch");
  const active = intro.data.filter(({ attributes: a }) =>
    (!a.startDate || a.startDate <= today) && (!a.endDate || a.endDate >= today));
  const territories = new Set();
  const points = new Map(intro.included.filter(item => item.type === "subscriptionPricePoints").map(item => [item.id, item]));
  const included = active.map((offer, index) => {
    const a = offer.attributes;
    const territory = offer.relationships?.territory?.data;
    const point = offer.relationships?.subscriptionPricePoint?.data;
    if (a.offerMode !== "PAY_UP_FRONT" || a.duration !== config.duration || a.numberOfPeriods !== 1 ||
        a.targetSubscriptionPlanType && a.targetSubscriptionPlanType !== "UPFRONT") throw new Error("Unexpected introductory terms");
    if (territory?.type !== "territories" || point?.type !== "subscriptionPricePoints" || territories.has(territory.id)) {
      throw new Error("Missing or duplicate territory/price point");
    }
    const price = points.get(point.id)?.attributes?.customerPrice;
    if (!price || !(Number(price) > 0)) throw new Error("Missing paid price point");
    if (["SVN", "USA"].includes(territory.id) && Number(price) !== Number(config.price)) throw new Error("Approved price mismatch");
    territories.add(territory.id);
    return { type: "subscriptionPromotionalOfferPrices", id: "${price-" + index + "}",
      relationships: { territory: { data: territory }, subscriptionPricePoint: { data: point } } };
  });
  if (!territories.has("SVN") || !territories.has("USA") ||
      availableTerritories.some(territory => !territories.has(territory)) || !availableTerritories.length) {
    throw new Error("Introductory prices do not cover available storefronts");
  }
  return { data: { type: "subscriptionPromotionalOffers", attributes: {
    name: config.name, offerCode: config.offerCode, duration: config.duration,
    offerMode: "PAY_UP_FRONT", numberOfPeriods: 1, targetSubscriptionPlanType: "UPFRONT",
  }, relationships: { subscription: { data: { type: "subscriptions", id: config.subscriptionId } },
    prices: { data: included.map(({ type, id }) => ({ type, id })) } } }, included };
}

export function verifyOffer(config, offer, prices, expected) {
  const a = offer.attributes;
  if (a.offerCode !== config.offerCode || a.offerMode !== "PAY_UP_FRONT" || a.duration !== config.duration || a.numberOfPeriods !== 1 ||
      a.targetSubscriptionPlanType && a.targetSubscriptionPlanType !== "UPFRONT") throw new Error("Existing offer terms differ; manual review required");
  const pairs = items => items.map(item => {
    const r = item.relationships;
    if (!r?.territory?.data?.id || !r?.subscriptionPricePoint?.data?.id) throw new Error("Incomplete offer price relationships");
    return `${r.territory.data.id}:${r.subscriptionPricePoint.data.id}`;
  }).sort();
  if (JSON.stringify(pairs(prices)) !== JSON.stringify(pairs(expected.included))) throw new Error("Existing offer prices differ; manual review required");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--apply")) throw new Error("Usage: half-off-offers.mjs [--apply]");
  const apply = args.includes("--apply");
  const keyID = process.env.ASC_KEY_ID || "M2VD53GP68";
  const issuer = process.env.ASC_ISSUER_ID || "6715f045-a181-4ad1-b072-5824a5bf1220";
  const key = await importPKCS8(readFileSync(`${process.env.HOME}/.config/memoai/apple/AuthKey_${keyID}.p8`, "utf8"), "ES256");
  const token = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: keyID, typ: "JWT" })
    .setIssuer(issuer).setIssuedAt().setExpirationTime("15m").setAudience("appstoreconnect-v1").sign(key);
  async function request(path, body) {
    const url = new URL(path, "https://api.appstoreconnect.apple.com");
    if (url.origin !== "https://api.appstoreconnect.apple.com") throw new Error("Unexpected pagination origin");
    const response = await fetch(url, { method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45_000) });
    const result = await response.json();
    if (!response.ok) throw new Error(`Apple ${response.status}: ${JSON.stringify(result.errors)}`);
    return result;
  }
  async function all(path) {
    const data = [], included = new Map();
    for (let page = 0; path; page++) {
      if (page >= 30) throw new Error("Pagination exceeded expected size");
      const result = await request(path);
      data.push(...result.data);
      for (const item of result.included ?? []) included.set(`${item.type}:${item.id}`, item);
      path = result.links?.next;
    }
    return { data, included: [...included.values()] };
  }
  const planned = [];
  for (const config of HALF_OFF_OFFERS) {
    const subscription = (await request(`/v1/subscriptions/${config.subscriptionId}`)).data;
    const intro = await all(`/v1/subscriptions/${config.subscriptionId}/introductoryOffers?limit=200&include=territory,subscriptionPricePoint`);
    const availability = (await request(`/v1/subscriptions/${config.subscriptionId}/subscriptionAvailability`)).data;
    const territories = await all(`/v1/subscriptionAvailabilities/${availability.id}/availableTerritories?limit=200`);
    const payload = offerRequest(config, subscription, intro, territories.data.map(item => item.id), new Date().toISOString().slice(0, 10));
    const offers = await all(`/v1/subscriptions/${config.subscriptionId}/promotionalOffers?limit=100`);
    const matching = offers.data.filter(item => item.attributes.offerCode === config.offerCode);
    if (matching.length > 1) throw new Error("Duplicate promotional offer identifier");
    planned.push({ config, payload, existing: matching[0] });
  }
  // Validate both plans before any mutation. An existing mismatch always stops.
  for (const { config, payload, existing } of planned) if (existing) {
    const prices = await all(`/v1/subscriptionPromotionalOffers/${existing.id}/prices?limit=200&include=territory,subscriptionPricePoint`);
    verifyOffer(config, existing, prices.data, payload);
  }
  for (const { config, payload, existing } of planned) {
    let offer = existing;
    if (!offer && apply) offer = (await request("/v1/subscriptionPromotionalOffers", payload)).data;
    if (offer) {
      // Fresh read proves Apple's saved state, not just an accepted POST.
      const saved = (await request(`/v1/subscriptionPromotionalOffers/${offer.id}`)).data;
      const prices = await all(`/v1/subscriptionPromotionalOffers/${offer.id}/prices?limit=200&include=territory,subscriptionPricePoint`);
      verifyOffer(config, saved, prices.data, payload);
    }
    console.log(JSON.stringify({ productId: config.productId, offerCode: config.offerCode,
      offerId: offer?.id ?? null, state: offer ? "verified" : "planned", territories: payload.included.length,
      firstPeriodSVN: `EUR ${config.price}`, firstPeriodUSA: `USD ${config.price}`, duration: config.duration }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
