import { isNativeUserAgent } from "@/lib/mobile/runtime";
import { getAppleEntitlement } from "@/lib/mobile/apple";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";

import {
  ensureStripeCustomer,
  getBillingCancelUrl,
  getBillingSuccessUrl,
  getCheckoutPriceId,
  getStripeClient,
  getViewerAppState,
  hasStripeSubscriptionHistory,
  PURCHASABLE_BILLING_PLAN_IDS,
} from "@/lib/billing";
import { hasLiveStripeSubscription } from "@/lib/billing-access";
import { getDiscountWheelState } from "@/lib/discount-wheel";
import { PAYWALL_LADDER, checkoutOffer } from "@/lib/paywall-ladder";
import { readPaywallMoments } from "@/lib/paywall-moments";
import { PAYWALL_REASONS } from "@/lib/paywall-reasons";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { STRIPE_CHECKOUT_LOCALE } from "@/lib/i18n/locales";
import { GEO_COUNTRY_HEADER, getLocale, tr } from "@/lib/i18n/server";

const checkoutSchema = z.object({
  plan: z.enum(PURCHASABLE_BILLING_PLAN_IDS),
  /** What opened the paywall; kept on the subscription for reporting. */
  reason: z.enum(PAYWALL_REASONS).nullish(),
  /** The rung the paywall showed; capped by the account's moments (`checkoutOffer`). */
  step: z.number().int().min(1).max(PAYWALL_LADDER.length).nullish(),
});

export async function POST(request: Request) {
  if (isNativeUserAgent(request.headers.get("user-agent"))) {
    return NextResponse.json({ error: await tr("native.manage"), code: "native_purchase_required" }, { status: 403 });
  }
  const appState = await getViewerAppState();

  if (!appState) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:billing:checkout:post",
    rules: rateLimitPresets.mutate,
    userId: appState.user.id,
  });

  if (limited) {
    return limited;
  }

  if (!appState.onboardingComplete) {
    return NextResponse.json({ error: await tr("api.finishOnboarding") }, { status: 400 });
  }
  if (await getAppleEntitlement(appState.user.id)) {
    return NextResponse.json({ error: await tr("native.active") }, { status: 409 });
  }

  const parsed = await parseJsonRequest(request, checkoutSchema, {
    maxBytes: 1024,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const customerId = await ensureStripeCustomer({
      userId: appState.user.id,
      email: appState.user.email ?? null,
      fullName: appState.profile?.full_name ?? null,
      existingCustomerId: appState.profile?.stripe_customer_id ?? null,
    });

    const stripe = getStripeClient();
    const existing = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
    if (hasLiveStripeSubscription(existing.data)) {
      return NextResponse.json(
        { error: await tr("api.subscriptionAlreadyActive"), code: "subscription_active" },
        { status: 409 },
      );
    }
    const hasPriorStripeSubscription = await hasStripeSubscriptionHistory({
      stripe,
      customerId,
      email: appState.user.email ?? appState.profile?.email ?? null,
    });
    // A prize from the home-screen wheel is applied here. Stripe rejects
    // `discounts` alongside `allow_promotion_codes`, so a won coupon replaces
    // the promo-code field rather than sitting next to it — the learner already
    // has their discount and does not need to type one.
    const wheel = await getDiscountWheelState(appState.user.id);
    const wheelCoupon = wheel.hasUnredeemedPrize ? wheel.coupon : null;
    // Otherwise the rung the paywall showed, never above what the recorded
    // paywall moments allow (`paywall-ladder.ts`). The wheel's 50 % beats it.
    const ladderOffer = checkoutOffer(parsed.data.step ?? null, await readPaywallMoments(appState.user.id));

    /*
     * The free trial comes with a ladder discount too; only the wheel's prize is
     * charged straight away, since it is a ten-minute offer sold as "now".
     *
     * With a trial the discount must be the one-month coupon (`trialCoupon`): a
     * `once` coupon is spent on the first invoice Stripe finalises, which with a
     * trial is the €0 trial invoice, and the buyer would then pay full price.
     */
    const subscriptionTrialEligible =
      appState.subscriptionTrialEligible && !hasPriorStripeSubscription && !wheelCoupon;
    const coupon =
      wheelCoupon ?? (subscriptionTrialEligible ? ladderOffer.trialCoupon : ladderOffer.coupon);
    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: {
        userId: appState.user.id,
        plan: parsed.data.plan,
        paywall_step: String(wheelCoupon ? 0 : ladderOffer.step),
        ...(parsed.data.reason ? { paywall_reason: parsed.data.reason } : {}),
      },
      ...(subscriptionTrialEligible ? { trial_period_days: 3 } : {}),
    };

    // The price the paywall showed this buyer: Vercel's IP country, not
    // anything in the request body (`billing-regions.ts`).
    const country = request.headers.get(GEO_COUNTRY_HEADER);
    const priceId = await getCheckoutPriceId(parsed.data.plan, country);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Stripe's own chrome — field labels, the pay button, card errors — in
      // the language the app is being read in.
      locale: STRIPE_CHECKOUT_LOCALE[await getLocale()],
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: getBillingSuccessUrl(request),
      cancel_url: getBillingCancelUrl(request, Boolean(wheelCoupon)),
      ...(coupon
        ? { discounts: [{ coupon }] }
        : { allow_promotion_codes: true }),
      billing_address_collection: "auto",
      // The refund policy leans on the buyer expressly asking for the service to
      // start before the 14-day withdrawal period runs out; that request has to
      // be captured at the moment of purchase, not at sign-up.
      custom_text: {
        submit: {
          // Stripe renders this on its own hosted page, so it has to be
          // handed over already translated — the checkout locale below only
          // covers Stripe's own chrome.
          message: await tr("api.checkoutConsent"),
        },
      },
      customer_update: {
        address: "auto",
        name: "auto",
      },
      metadata: {
        userId: appState.user.id,
        plan: parsed.data.plan,
      },
      subscription_data: subscriptionData,
    });

    /*
     * The prize is deliberately not spent here.
     *
     * Opening Stripe and coming back is an ordinary thing to do — the buyer
     * wants another look at the plans, or their card is in the other room —
     * and spending the coupon at session creation meant the offer they
     * returned to was already dead, with its countdown still running. It ends
     * where the offer says it ends: when the ten minutes run out, or when the
     * sheet is closed without buying.
     */

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : await tr("api.checkoutSessionFailed"),
      },
      { status: 500 },
    );
  }
}
