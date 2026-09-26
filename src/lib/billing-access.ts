import type { BillingSubscriptionRow } from "@/lib/database.types";

export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * How long a renewing plan keeps access after the period end we last stored.
 *
 * Stripe moves a subscription into its next period a little after the boundary
 * (the invoice is created, then the webhook updates our row), not at the exact
 * second. On 2026-09-13 a learner's 3-day trial ended at 12:14:50; the tutor
 * refused them at 12:15:15, 25 seconds before Stripe billed the first month,
 * and the paywall sold them a second subscription on top of the one that was
 * converting. Only a plan that is set to renew gets the window: one the learner
 * cancelled ends exactly when it says, and a renewal that fails becomes
 * `past_due` and later `canceled`, which the status check already handles.
 */
export const PERIOD_ROLLOVER_GRACE_MS = 2 * 60 * 60 * 1000;

export function subscriptionPeriodAllowsAccess(subscription: BillingSubscriptionRow, nowMs = Date.now()) {
  if (!subscription.current_period_end) {
    return true;
  }

  const periodEndMs = Date.parse(subscription.current_period_end);
  const graceMs = subscription.cancel_at_period_end ? 0 : PERIOD_ROLLOVER_GRACE_MS;

  return Number.isFinite(periodEndMs) && periodEndMs + graceMs > nowMs;
}

export function hasPaidAccess(subscription: BillingSubscriptionRow | null, nowMs = Date.now()) {
  return Boolean(
    subscription &&
      ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status) &&
      subscriptionPeriodAllowsAccess(subscription, nowMs),
  );
}

/**
 * Whether a customer's Stripe subscriptions include one that is still live.
 *
 * Checkout asks Stripe itself, not our copy: on 2026-09-13 the stored row was the
 * stale one, and trusting it sold a learner a second monthly plan three minutes
 * after their first had converted.
 */
export function hasLiveStripeSubscription(subscriptions: ReadonlyArray<{ status: string }>) {
  return subscriptions.some((subscription) => ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status));
}
