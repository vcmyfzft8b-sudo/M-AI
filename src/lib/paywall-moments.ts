import "server-only";

import { readSeenReasons, recordSeenReason } from "@/lib/paywall-ladder";
import type { PaywallReason } from "@/lib/paywall-reasons";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * The discount ladder's moments, stored on the account (`profiles.paywall_moments`,
 * migration 0064) so they follow the learner rather than the device.
 *
 * Read and written with the service role, the way the wheel's prize is. A
 * failed read is "no moments yet": the worst that does is show the plain
 * price, never a discount the account has not reached.
 */
export async function readPaywallMoments(userId: string): Promise<PaywallReason[]> {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("profiles")
    .select("paywall_moments")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("paywall moments: read failed", error.message);
    return [];
  }

  // The generated types do not resolve this table; read it as the wheel does.
  const row = (data ?? null) as { paywall_moments: unknown } | null;
  return readSeenReasons(row?.paywall_moments);
}

/**
 * Records a paywall moment unless this visit was already counted, and returns
 * the moments before and after. Read, then write: two paywalls recorded in the
 * same instant may count once, which only ever costs the learner a rung.
 */
export async function recordPaywallMoment(
  userId: string,
  reason: PaywallReason,
  alreadyCounted: boolean,
): Promise<{ before: PaywallReason[]; after: PaywallReason[] }> {
  const before = await readPaywallMoments(userId);
  const after = alreadyCounted ? before : recordSeenReason(before, reason);

  if (after.length !== before.length) {
    const { error } = await createSupabaseServiceRoleClient()
      .from("profiles")
      .update({ paywall_moments: after } as never)
      .eq("id", userId);

    if (error) {
      console.warn("paywall moments: write failed", error.message);
      return { before, after: before };
    }
  }

  return { before, after };
}
