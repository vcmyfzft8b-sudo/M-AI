/*
 * Creates the Stripe prices for `REGIONAL_PLAN_PRICES` (src/lib/billing-regions.ts).
 *
 *   STRIPE_SECRET_KEY=sk_... node --experimental-strip-types scripts/setup-regional-prices.mjs [--apply]
 *
 * Dry run by default. Each price goes on the same product as the standard
 * monthly price (STRIPE_PRICE_MONTHLY, or the `app=memo billing_key=pro`
 * product) with the lookup key checkout finds it by. Safe to re-run: a lookup
 * key that already points at the right amount is left alone, and one that
 * points at a different amount is moved to a new price (`transfer_lookup_key`),
 * which is how a regional price is changed. The old price stays on the
 * subscriptions already using it.
 */
import Stripe from "stripe";

import { REGIONAL_PLAN_PRICES, regionalPriceLookupKey } from "../src/lib/billing-regions.ts";

const apply = process.argv.includes("--apply");
const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

if (!secretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY.");
}

const stripe = new Stripe(secretKey);

async function memoProduct() {
  const monthlyPriceId = process.env.STRIPE_PRICE_MONTHLY?.trim();

  if (monthlyPriceId) {
    const price = await stripe.prices.retrieve(monthlyPriceId);
    return typeof price.product === "string" ? price.product : price.product.id;
  }

  const products = await stripe.products.list({ active: true, limit: 100 });
  const product = products.data.find((item) => item.metadata?.app === "memo" && item.metadata?.billing_key === "pro");

  if (!product) {
    throw new Error("No Memo Pro product found; set STRIPE_PRICE_MONTHLY.");
  }

  return product.id;
}

const productId = await memoProduct();
console.log(`${apply ? "Applying" : "Dry run"} on product ${productId}`);

for (const [region, prices] of Object.entries(REGIONAL_PLAN_PRICES)) {
  for (const plan of ["monthly", "yearly"]) {
    const lookupKey = regionalPriceLookupKey(plan, region);
    const unitAmount = Math.round(prices[plan] * 100);
    const { data } = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    const existing = data[0];

    if (existing?.unit_amount === unitAmount && existing.currency === "eur") {
      console.log(`  ok       ${lookupKey} €${unitAmount / 100} (${existing.id})`);
      continue;
    }

    const action = existing ? `move from €${(existing.unit_amount ?? 0) / 100}` : "create";
    console.log(`  ${apply ? "doing" : "would"}  ${lookupKey} €${unitAmount / 100} (${action})`);

    if (!apply) {
      continue;
    }

    const created = await stripe.prices.create(
      {
        product: productId,
        currency: "eur",
        unit_amount: unitAmount,
        recurring: { interval: plan === "yearly" ? "year" : "month", interval_count: 1 },
        lookup_key: lookupKey,
        transfer_lookup_key: true,
        nickname: `Memo ${plan} (${region})`,
        metadata: { app: "memo", billing_key: "pro", plan, region },
      },
      { idempotencyKey: `memo-regional-price-${lookupKey}-${unitAmount}` },
    );
    console.log(`           -> ${created.id}`);
  }
}
