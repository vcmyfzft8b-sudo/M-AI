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
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";

const checkoutSchema = z.object({
  plan: z.enum(PURCHASABLE_BILLING_PLAN_IDS),
});

export async function POST(request: Request) {
  const appState = await getViewerAppState();

  if (!appState) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
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
    return NextResponse.json({ error: "Najprej dokončaj uvodno nastavitev." }, { status: 400 });
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
     * A discounted purchase is not also a trial.
     *
     * The coupon is `duration: once`, so it halves the first invoice — and a
     * trial pushes that invoice three days out, past the ten minutes the offer
     * was sold on and past the moment the buyer agreed to it. Stripe then shows
     * "3 days free, then €130,00 per year", which is the undiscounted price and
     * the opposite of what the sheet promised. Charging the discounted period
     * straight away is what the offer actually says.
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
      customer: customerId,
      line_items: [
        {
          price: getPriceIdForPlan(parsed.data.plan),
          quantity: 1,
        },
      ],
      success_url: getBillingSuccessUrl(request),
      cancel_url: getBillingCancelUrl(request, Boolean(wheelCoupon)),
      ...(wheelCoupon
        ? { discounts: [{ coupon: wheelCoupon }] }
        : { allow_promotion_codes: true }),
      billing_address_collection: "auto",
      // The refund policy leans on the buyer expressly asking for the service to
      // start before the 14-day withdrawal period runs out; that request has to
      // be captured at the moment of purchase, not at sign-up.
      custom_text: {
        submit: {
          message:
            "Z nakupom izrecno zahtevaš, da se izvajanje storitve začne takoj in pred iztekom 14-dnevnega odstopnega roka. Če kot potrošnik med tem rokom odstopiš, ti vrnemo plačilo, zmanjšano za sorazmerni del že opravljene storitve. Veljata tudi pogoji uporabe in politika vračil na memoai.eu/legal.",
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
        error: error instanceof Error ? error.message : "Checkout seje ni bilo mogoče ustvariti.",
      },
      { status: 500 },
    );
  }
}
