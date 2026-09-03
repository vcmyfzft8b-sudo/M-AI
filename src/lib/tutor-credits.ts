import "server-only";

import type Stripe from "stripe";

import { getServerEnv } from "@/lib/server-env";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { creditTutorSeconds, TUTOR_CREDIT_PACK_SECONDS } from "@/lib/tutor-usage";

/**
 * Buying more tutor time.
 *
 * One product, one price, sold by the hour — the simplest thing that answers "I want to keep
 * going tonight" without turning a study app into a metered utility. It is a one-off payment
 * rather than anything recurring, so it is settled in the webhook where the money is known to
 * have arrived, not in the browser where only the intention is.
 */

/** Marks a checkout session as ours, so the webhook knows what it is looking at. */
export const TUTOR_CREDIT_METADATA_KIND = "tutor_credit_hours";

export function getTutorCreditPriceId() {
  return getServerEnv().STRIPE_PRICE_TUTOR_HOUR ?? null;
}

/**
 * Credits a completed top-up, once.
 *
 * Stripe redelivers webhooks on any non-2xx and on its own schedule, so this must be safe to
 * run repeatedly. The checkout session's id is recorded against the grant, and a second
 * delivery of the same id is dropped — the alternative is an account that quietly gains an
 * hour every time Stripe retries.
 */
export async function creditTutorPurchase(session: Stripe.Checkout.Session) {
  if (session.metadata?.kind !== TUTOR_CREDIT_METADATA_KIND) {
    return;
  }

  const userId = session.metadata?.userId;
  const hours = Number(session.metadata?.hours ?? "1");

  if (!userId || !Number.isFinite(hours) || hours <= 0) {
    console.error("[tutor] a top-up arrived without a usable user or quantity", {
      sessionId: session.id,
    });

    return;
  }

  const supabase = createSupabaseServiceRoleClient();
  const { error: claimError } = await supabase.from("tutor_credit_purchases").insert({
    stripe_checkout_session_id: session.id,
    user_id: userId,
    seconds: Math.round(hours * TUTOR_CREDIT_PACK_SECONDS),
    amount_total: session.amount_total ?? 0,
    currency: session.currency ?? "eur",
  } as never);

  if (claimError) {
    // 23505: this session has already been credited. A redelivery, not a problem.
    if ((claimError as { code?: string }).code === "23505") {
      return;
    }

    throw claimError;
  }

  await creditTutorSeconds({
    userId,
    seconds: Math.round(hours * TUTOR_CREDIT_PACK_SECONDS),
  });
}
