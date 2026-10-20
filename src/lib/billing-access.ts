import type { BillingSubscriptionRow, ProfileRow } from "@/lib/database.types";

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

export function subscriptionPeriodAllowsAccess(
  subscription: Pick<BillingSubscriptionRow, "current_period_end" | "cancel_at_period_end">,
  nowMs = Date.now(),
) {
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

/**
 * Whether a row is a comp: free premium we granted by hand, with nothing behind it in Stripe.
 *
 * A comp is a row written straight into `billing_subscriptions` for somebody with no Stripe
 * subscription to extend: `stripe_subscription_id` is `comp_<user id prefix>_<end date>`, with no
 * customer, no price and an amount of 0. It grants access like any other row until its
 * `current_period_end`, but no webhook ever touches it, so its status stays `active` after it
 * ends. Stripe's own ids start with `sub_`, never `comp_`.
 */
export function isCompSubscriptionRow(row: Pick<BillingSubscriptionRow, "stripe_subscription_id">) {
  return row.stripe_subscription_id.startsWith("comp_");
}

/**
 * Whether this account has had a subscription before, which costs it the free trial at checkout.
 *
 * A comp is not one. On 2026-10-20 four free learners were given three comped days as an
 * apology for an outage, and counting those rows here would have quietly and permanently taken
 * away the three-day trial every one of them was still owed.
 */
export function hasPriorSubscriptionHistory(
  profile: Pick<ProfileRow, "subscription_trial_started_at"> | null,
  subscriptions: ReadonlyArray<Pick<BillingSubscriptionRow, "stripe_subscription_id">>,
) {
  return Boolean(
    profile?.subscription_trial_started_at ||
      subscriptions.some((subscription) => !isCompSubscriptionRow(subscription)),
  );
}

/**
 * The row that grants access, or else the latest one to describe the account by.
 *
 * An ended comp is never that description. Its status still says `active`, so settings would
 * show a plan the account no longer has and offer to manage it in a Stripe portal that has
 * nothing in it; without a row the account reads as having no subscription, which is true.
 */
export function getActiveSubscription(
  subscriptions: BillingSubscriptionRow[],
  nowMs = Date.now(),
): BillingSubscriptionRow | null {
  const sorted = [...subscriptions].sort((left, right) =>
    right.updated_at.localeCompare(left.updated_at),
  );

  return (
    sorted.find((subscription) => hasPaidAccess(subscription, nowMs)) ??
    sorted.find((subscription) => !isCompSubscriptionRow(subscription)) ??
    null
  );
}
