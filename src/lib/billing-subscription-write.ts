/**
 * Stripe statuses a subscription never leaves. A canceled subscription cannot be
 * reactivated, and an expired incomplete one cannot be paid; the customer gets a new
 * subscription with a new id instead.
 */
export const TERMINAL_SUBSCRIPTION_STATUSES = ["canceled", "incomplete_expired"] as const;

export type StripeSubscriptionRowWrite = {
  stripe_subscription_id: string;
  status: string;
  [column: string]: unknown;
};

type WriteResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** The slice of the Supabase query builder for `billing_subscriptions` this needs. */
export type BillingSubscriptionsTable = {
  update(row: object): {
    eq(
      column: "stripe_subscription_id",
      value: string,
    ): {
      not(column: "status", operator: "in", value: string): {
        select(columns: "id"): WriteResult;
      };
    };
  };
  upsert(row: object, options: { onConflict: string; ignoreDuplicates?: boolean }): WriteResult;
};

/**
 * Stores a subscription's state without letting a late webhook resurrect one that has ended.
 *
 * Stripe does not deliver events in order. On 2026-10-03 support voided the open invoice of
 * a past_due subscription and then cancelled it: voiding emitted `updated` with `active`,
 * cancelling emitted `deleted` with `canceled`, and `active` arrived last, so the row granted
 * paid access to a subscription that was gone. The webhook now writes what Stripe says at the
 * time it handles the event rather than what the event carried, which fixes ordering between
 * live states; this closes what is left, two deliveries racing, for the one case where it
 * matters most. An ended status always wins, and once a row has ended nothing overwrites it.
 *
 * Each branch is a single statement, so there is no read-then-write window: the guarded update
 * skips an ended row in the database itself, and the insert that follows it only creates a row
 * that does not exist yet.
 */
export async function writeStripeSubscriptionRow(
  table: BillingSubscriptionsTable,
  row: StripeSubscriptionRowWrite,
) {
  if ((TERMINAL_SUBSCRIPTION_STATUSES as readonly string[]).includes(row.status)) {
    return check(await table.upsert(row, { onConflict: "stripe_subscription_id" }));
  }

  const updateUnlessEnded = async () =>
    check(
      await table
        .update(row)
        .eq("stripe_subscription_id", row.stripe_subscription_id)
        .not("status", "in", `(${TERMINAL_SUBSCRIPTION_STATUSES.join(",")})`)
        .select("id"),
    );

  const updated = await updateUnlessEnded();

  if (Array.isArray(updated) && updated.length > 0) {
    return updated;
  }

  // Either the row is new, or it has ended and must stay as it is.
  check(await table.upsert(row, { onConflict: "stripe_subscription_id", ignoreDuplicates: true }));

  // If another delivery inserted the row between our update and our insert, the insert was
  // dropped; apply this state over theirs, unless theirs had ended.
  return updateUnlessEnded();
}

function check(result: { data: unknown; error: { message: string } | null }) {
  if (result.error) {
    // Thrown so the webhook answers 500 and Stripe redelivers, rather than leaving a stale row.
    throw new Error(`Failed to store Stripe subscription: ${result.error.message}`);
  }

  return result.data;
}
