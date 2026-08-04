import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";

import {
  ensureStripeCustomer,
  getBillingCancelUrl,
  getBillingSuccessUrl,
  getPriceIdForPlan,
  getStripeClient,
  getViewerAppStateForRequest,
  hasStripeSubscriptionHistory,
  PURCHASABLE_BILLING_PLAN_IDS,
} from "@/lib/billing";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";

const checkoutSchema = z.object({
  plan: z.enum(PURCHASABLE_BILLING_PLAN_IDS),
});

export async function POST(request: Request) {
  const appState = await getViewerAppStateForRequest(request);

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
    const subscriptionTrialEligible =
      appState.subscriptionTrialEligible && !hasPriorStripeSubscription;
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
      cancel_url: getBillingCancelUrl(request),
      allow_promotion_codes: true,
      billing_address_collection: "auto",
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
