import { randomUUID } from "node:crypto";
import { PromotionalOfferSignatureCreator } from "@apple/app-store-server-library";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getStripeClient, getPriceIdForPlan, getUserEntitlementState } from "@/lib/billing";
import { appleBillingConfigured, appleAccountEnvironments } from "@/lib/mobile/apple";
import { APPLE_CODE_OFFERS, acceptsAppleHalfOffCode } from "@/lib/mobile/promotion-policy";
import { accountDeletionRequested } from "@/lib/mobile/account-lifecycle";
import { createSupabaseRouteHandlerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { tr } from "@/lib/i18n/server";

export const runtime = "nodejs";
const schema = z.object({ code: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  productId: z.enum(["eu.memoai.premium.monthly", "eu.memoai.premium.yearly"]).optional() }).strict();

export async function POST(request: Request) {
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const reply = (body: object, status = 200) => applyCookies(NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }));
  if (!appleBillingConfigured()) return reply({ error: await tr("native.unavailable") }, 503);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || accountDeletionRequested(user)) return reply({ error: await tr("api.unauthorized") }, 401);
  const limited = await enforceRateLimit({ request, userId: user.id, route: "mobile:promotions", rules: rateLimitPresets.mutate });
  if (limited) return limited;
  const parsed = await parseJsonRequest(request, schema, { maxBytes: 1024 });
  if (!parsed.success) return parsed.response;
  try {
    if ((await getUserEntitlementState(user.id)).hasPaidAccess) return reply({ error: await tr("native.active") }, 409);
    const { code, productId } = parsed.data;
    const stripe = getStripeClient();
    // Catalogue reads only. Apple checkout never creates a Stripe customer,
    // checkout session, payment, subscription or coupon redemption.
    const codes = await stripe.promotionCodes.list({ code, active: true, limit: 100 });
    if (codes.has_more || codes.data.length !== 1) return reply({ error: await tr("native.codeUnavailable") }, 422);
    const promotion = codes.data[0];
    const reference = promotion.promotion.coupon;
    if (!reference) return reply({ error: await tr("native.codeUnavailable") }, 422);
    const coupon = typeof reference === "string" ? await stripe.coupons.retrieve(reference) : reference;
    const ids = productId ? [productId] : Object.keys(APPLE_CODE_OFFERS) as (keyof typeof APPLE_CODE_OFFERS)[];
    for (const id of ids) {
      let product = "";
      if (coupon.applies_to?.products?.length) {
        const price = await stripe.prices.retrieve(getPriceIdForPlan(id.endsWith(".monthly") ? "monthly" : "yearly"));
        product = typeof price.product === "string" ? price.product : price.product.id;
      }
      if (!acceptsAppleHalfOffCode(code, promotion, coupon, product, Math.floor(Date.now() / 1000))) {
        return reply({ error: await tr("native.codeUnavailable") }, 422);
      }
    }
    const history = await createSupabaseServiceRoleClient().from("mobile_app_store_entitlements")
      .select("original_transaction_id").eq("user_id", user.id).in("environment", appleAccountEnvironments(user.id)).limit(1);
    if (history.error) throw new Error("Apple history unavailable");
    const mode = history.data?.length ? "promotional" : "introductory";
    const result = { userId: user.id, mode, offers: APPLE_CODE_OFFERS };
    if (!productId || mode === "introductory") return reply(result);
    const nonce = randomUUID().toLowerCase(), timestamp = Date.now();
    const keyId = process.env.APPLE_IAP_KEY_ID!;
    const creator = new PromotionalOfferSignatureCreator(process.env.APPLE_IAP_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      keyId, process.env.APPLE_BUNDLE_ID || "eu.memoai.memo");
    const offerId = APPLE_CODE_OFFERS[productId];
    const signature = creator.createSignature(productId, offerId, user.id.toLowerCase(), nonce, timestamp);
    return reply({ ...result, signature: { offerId, keyId, nonce, timestamp, signature } });
  } catch {
    return reply({ error: await tr("native.unavailable") }, 503);
  }
}
