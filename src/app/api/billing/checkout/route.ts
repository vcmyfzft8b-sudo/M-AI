import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";

import {
  ensureStripeCustomer,
  getBillingCancelUrl,
  getBillingSuccessUrl,
  getPriceIdForPlan,
  getStripeClient,
  getViewerAppState,
  hasStripeSubscriptionHistory,
  PURCHASABLE_BILLING_PLAN_IDS,
} from "@/lib/billing";
import { getDiscountWheelState } from "@/lib/discount-wheel";
import { resolveGiveawayReferral } from "@/lib/giveaway";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { STRIPE_CHECKOUT_LOCALE } from "@/lib/i18n/locales";
import { getLocale, tr } from "@/lib/i18n/server";

const checkoutSchema = z.object({
  plan: z.enum(PURCHASABLE_BILLING_PLAN_IDS),
});

export async function POST(request: Request) {
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
    /*
     * A friend's giveaway code, carried in from the share link. It is the
     * same 50 % coupon as the wheel's prize, so the two never stack; the code
     * wins because it is the one that credits somebody. The Stripe discount
     * is created from the promotion code rather than the coupon so the
     * webhook can see whose code it was.
     */
    const referral = await resolveGiveawayReferral(appState.user.id);
    const discount: Stripe.Checkout.SessionCreateParams.Discount | null = referral
      ? { promotion_code: referral.stripePromotionCodeId }
      : wheelCoupon
        ? { coupon: wheelCoupon }
        : null;

    /*
     * A discounted purchase is not also a trial.
     *
     * The coupon is `duration: once`, so it halves the first invoice — and a
     * trial pushes that invoice three days out, past the ten minutes the offer
     * was sold on and past the moment the buyer agreed to it. Stripe then shows
     * "3 days free, then €130,00 per year", which is the undiscounted price and
     * the opposite of what the sheet promised. Charging the discounted period
     * straight away is what the offer actually says.
     */
    /*
     * A friend's giveaway code keeps the trial: the paywall promised three
     * free days and says nothing about the code, so the buyer sees exactly
     * what it said, and the 50 % lands on the first paid invoice — the same
     * path as a code typed on Stripe's page. Only the wheel's prize removes
     * the trial, for the reasons above.
     */
    const subscriptionTrialEligible =
      appState.subscriptionTrialEligible && !hasPriorStripeSubscription && !wheelCoupon;
    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: {
        userId: appState.user.id,
        plan: parsed.data.plan,
      },
      ...(subscriptionTrialEligible ? { trial_period_days: 3 } : {}),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Stripe's own chrome — field labels, the pay button, card errors — in
      // the language the app is being read in.
      locale: STRIPE_CHECKOUT_LOCALE[await getLocale()],
      customer: customerId,
      line_items: [
        {
          price: getPriceIdForPlan(parsed.data.plan),
          quantity: 1,
        },
      ],
      success_url: getBillingSuccessUrl(request),
      cancel_url: getBillingCancelUrl(request, Boolean(wheelCoupon) && !referral),
      ...(discount ? { discounts: [discount] } : { allow_promotion_codes: true }),
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
