/**
 * Which plan an account is on, derived from its subscription rows.
 *
 * Kept in its own module, free of imports, for two reasons. It is the rule both
 * the plan tabs on /admin/users and the totals above them classify through, and
 * having one copy is what stops those two disagreeing on screen. And `users.ts`
 * pulls in `server-only` and the Supabase client, so nothing in it can be unit
 * tested; this can.
 */

/** Subscription statuses that grant access, paid or trial. */
export const ACTIVE_STATUS_LIST = ["active", "trialing", "past_due"] as const;

export const ACTIVE_STATUSES: ReadonlySet<string> = new Set(ACTIVE_STATUS_LIST);

export type PlanMembership = { paying: Set<string>; trialing: Set<string> };

/**
 * Split live subscription rows into who is paying and who is on trial.
 *
 * Someone can hold both a paid row and a trial row; they are paying. The two
 * sets never overlap, so paying, trialing and "in neither" partition the
 * accounts exactly -- which is what lets the three plan tabs add back up to the
 * total.
 */
export function classifyPlanMembership(
  rows: Array<{ user_id: string; status: string }>,
): PlanMembership {
  const paying = new Set<string>();
  const trialing = new Set<string>();

  for (const row of rows) {
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
