/**
 * Which plan an account is on, derived from its subscription rows.
 *
 * Kept in its own module, free of server-only imports, for two reasons. It is the rule both
 * the plan tabs on /admin/users and the totals above them classify through, and
 * having one copy is what stops those two disagreeing on screen. And `users.ts`
 * pulls in `server-only` and the Supabase client, so nothing in it can be unit
 * tested; this can.
 */

import { isCompSubscriptionRow, subscriptionPeriodAllowsAccess } from "../billing-access.ts";

/** Subscription statuses that grant access, paid or trial. */
export const ACTIVE_STATUS_LIST = ["active", "trialing", "past_due"] as const;

export const ACTIVE_STATUSES: ReadonlySet<string> = new Set(ACTIVE_STATUS_LIST);

export type PlanMembership = { paying: Set<string>; trialing: Set<string> };

type PlanRow = { user_id: string; status: string; stripe_subscription_id: string };

/**
 * Whether a row still holds a plan, for picking which of an account's rows to show.
 *
 * The status alone answers that for a Stripe row, whose webhook moves it on. A comp's status
 * stays `active` for good once written (`isCompSubscriptionRow`), so only its end date can say it
 * is over.
 */
export function holdsPlan(
  row: PlanRow & { current_period_end: string | null; cancel_at_period_end: boolean },
  nowMs = Date.now(),
) {
  return (
    ACTIVE_STATUSES.has(row.status) &&
    (!isCompSubscriptionRow(row) || subscriptionPeriodAllowsAccess(row, nowMs))
  );
}

/**
 * Split live subscription rows into who is paying and who is on trial.
 *
 * Someone can hold both a paid row and a trial row; they are paying. The two
 * sets never overlap, so paying, trialing and "in neither" partition the
 * accounts exactly -- which is what lets the three plan tabs add back up to the
 * total.
 *
 * A comp is neither: nobody pays for it and it does not convert, and since its
 * status never leaves `active` it used to count as paying long after it ended.
 * A comped account is filed with the free ones.
 */
export function classifyPlanMembership(rows: PlanRow[]): PlanMembership {
  const paying = new Set<string>();
  const trialing = new Set<string>();

  for (const row of rows) {
    if (isCompSubscriptionRow(row)) {
      continue;
    }

    if (row.status === "trialing") {
      trialing.add(row.user_id);
    } else {
      paying.add(row.user_id);
    }
  }

  for (const id of paying) {
    trialing.delete(id);
  }

  return { paying, trialing };
}
