import { NextResponse } from "next/server";

import {
  ensureStripeCustomer,
  getBillingCancelUrl,
  getBillingSuccessUrl,
  getStripeClient,
  getViewerAppState,
} from "@/lib/billing";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { STRIPE_CHECKOUT_LOCALE } from "@/lib/i18n/locales";
import { getLocale, tr } from "@/lib/i18n/server";
import { getTutorCreditPriceId, TUTOR_CREDIT_METADATA_KIND } from "@/lib/tutor-credits";

/**
 * Buys an hour of tutor time.
 *
 * A one-off payment, not a plan — mode `payment`, so nothing recurs and nothing has to be
 * cancelled later. The seconds are not granted here: this only opens the checkout. They are
 * credited by the webhook, once Stripe says the money actually arrived.
 *
 * Only offered to accounts that already subscribe. Somebody without a plan should be buying
 * the plan, not an hour of one feature inside it.
 */
export async function POST(request: Request) {
  const appState = await getViewerAppState();

  if (!appState) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:billing:tutor-credits:post",
    rules: rateLimitPresets.mutate,
    userId: appState.user.id,
  });

  if (limited) {
    return limited;
  }

  /*
   * Subscribers only, enforced here and not just in the UI that hides the button. A free
   * account's credits are kept but never spent — the lifetime minute is the whole free
   * allowance — so letting one through would take €2 for seconds it cannot use.
   */
  if (!appState.hasPaidAccess) {
    return NextResponse.json(
      { error: await tr("api.tutorTrialUsed"), code: "tutor_trial_used" },
      { status: 402 },
    );
  }

  const priceId = getTutorCreditPriceId();

  if (!priceId) {
    console.error("[tutor] STRIPE_PRICE_TUTOR_HOUR is not configured");

    return NextResponse.json({ error: await tr("tutor.error.creditsFailed") }, { status: 503 });
  }

  try {
    const customerId = await ensureStripeCustomer({
      userId: appState.user.id,
      email: appState.user.email ?? null,
      fullName: appState.profile?.full_name ?? null,
      existingCustomerId: appState.profile?.stripe_customer_id ?? null,
    });

    const session = await getStripeClient().checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: getBillingSuccessUrl(),
      cancel_url: getBillingCancelUrl(),
      locale: STRIPE_CHECKOUT_LOCALE[await getLocale()],
      /*
       * The webhook has only this to go on: the session carries no Supabase identity of its
       * own, and matching on the Stripe customer would credit the wrong account the first
       * time somebody's customer record is merged.
       */
      metadata: {
        kind: TUTOR_CREDIT_METADATA_KIND,
        userId: appState.user.id,
        hours: "1",
      },
    });

    if (!session.url) {
      throw new Error("Stripe returned a checkout session with no URL.");
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[tutor] opening a top-up checkout failed", error);

    return NextResponse.json({ error: await tr("tutor.error.creditsFailed") }, { status: 502 });
  }
}
