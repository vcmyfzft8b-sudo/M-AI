import "server-only";

import Stripe from "stripe";
import { getStripeClient } from "@/lib/billing";

/** Catalogue-only credential, separate from the key used by web checkout. */
export function applePromotionCatalogue() {
  const key = process.env.APPLE_PROMOTION_CATALOGUE_KEY?.trim();
  if (key) {
    // Hosted previews may read the live catalogue with a restricted key, or
    // use a Stripe sandbox. Never introduce an unrestricted live secret there.
    if (process.env.VERCEL_ENV === "preview" && !/^(rk_(live|test)_|sk_test_)/.test(key)) {
      throw new Error("Preview requires a restricted catalogue or sandbox key");
    }
    return new Stripe(key, { maxNetworkRetries: 2 });
  }
  if (process.env.VERCEL_ENV === "preview") {
    throw new Error("Preview catalogue credential is not configured");
  }
  return getStripeClient();
}
