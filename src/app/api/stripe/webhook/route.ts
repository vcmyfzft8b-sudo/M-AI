import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  issueFiscalCreditNotesForCharge,
  issueFiscalInvoiceForCheckoutSession,
  issueFiscalInvoiceForStripeInvoice,
} from "@/lib/fiscal/fiscal-invoices";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getServerEnv } from "@/lib/server-env";
import { syncStripeSubscription } from "@/lib/billing";
import { creditTutorPurchase } from "@/lib/tutor-credits";

function extractSubscriptionId(event: Stripe.Event) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    return typeof session.subscription === "string" ? session.subscription : null;
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    return (event.data.object as Stripe.Subscription).id;
  }

  return null;
}

export async function POST(request: Request) {
  const limited = await enforceRateLimit({
    request,
    route: "api:stripe:webhook:post",
    rules: rateLimitPresets.stripeWebhook,
  });

  if (limited) {
    return limited;
  }

  const env = getServerEnv();

  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const payload = await request.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error("Stripe webhook signature verification failed", {
      error,
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Webhook signature verification failed.",
      },
      { status: 400 },
    );
  }

  try {
    /*
     * A tutor top-up is a one-off payment, not a subscription, so it never reaches the
     * subscription sync below — it has no subscription id at all. The seconds are credited
     * here, from the session's own metadata, and only once the payment has actually landed.
     * Stripe redelivers webhooks, so this has to be safe to run twice: `creditedFor` keys the
     * grant to the checkout session, and a repeat is dropped rather than paid twice.
     */
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.mode === "payment" && session.payment_status === "paid") {
        await creditTutorPurchase(session);
      }
    }

    /*
     * Stripe does not deliver events in order, so the subscription in the payload may already
     * be out of date: on 2026-10-03 a voided invoice's `updated` (active) landed after the
     * cancellation's `deleted` (canceled) and left a canceled subscription granting access.
     * Every event is therefore only a prompt to ask Stripe for the subscription as it is now.
     * A canceled subscription is still retrievable, so `deleted` works the same way.
     */
    const subscriptionId = extractSubscriptionId(event);

    if (subscriptionId) {
      await syncStripeSubscription(subscriptionId);
    }

    /*
     * Card payments through Stripe count as cash under ZDavPR, so each one gets an invoice that
     * FURS confirms, and each refund a credit note (docs/fiscal-verification.md). Nothing happens
     * until FURS_ENABLED and the certificate are configured. A FURS outage does not fail the
     * webhook: the invoice is issued without an EOR and the cron sends it again.
     */
    if (event.type === "invoice.paid") {
      await issueFiscalInvoiceForStripeInvoice(stripe, event.data.object as Stripe.Invoice);
    }

    if (event.type === "checkout.session.completed") {
      await issueFiscalInvoiceForCheckoutSession(event.data.object as Stripe.Checkout.Session);
    }

    if (event.type === "charge.refunded") {
      await issueFiscalCreditNotesForCharge(stripe, event.data.object as Stripe.Charge);
    }

    // A card refund can still be pending when charge.refunded arrives; it gets its credit note
    // when it succeeds.
    if (event.type === "charge.refund.updated") {
      const refund = event.data.object as Stripe.Refund;
      const chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge?.id;

      if (refund.status === "succeeded" && chargeId) {
        await issueFiscalCreditNotesForCharge(stripe, await stripe.charges.retrieve(chargeId));
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed", {
      eventId: event.id,
      eventType: event.type,
      error,
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Webhook handling failed.",
      },
      { status: 500 },
    );
  }
}
