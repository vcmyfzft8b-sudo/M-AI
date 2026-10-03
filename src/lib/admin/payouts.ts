import "server-only";

import type { UgcCreatorPayoutRow } from "@/lib/database.types";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

import { periodOf, periodStart, type PeriodKey } from "./payouts-math.ts";

export type PayoutWithCreator = UgcCreatorPayoutRow & {
  creator: {
    id: string;
    name: string;
    payout_details: string | null;
    promo_codes: string[];
  } | null;
};

const PAYOUT_SELECT =
  "*, creator:ugc_creators(id, name, payout_details, promo_codes)";

/** Every payout line for one month, biggest first. */
export async function listPayoutsForPeriod(
  period: PeriodKey,
): Promise<PayoutWithCreator[]> {
  const serviceRole = createSupabaseServiceRoleClient();
  const { data, error } = await serviceRole
    .from("ugc_creator_payouts")
    .select(PAYOUT_SELECT)
    .eq("period", periodStart(period))
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Could not load payouts: ${error.message}`);
  }

  return (data as unknown as PayoutWithCreator[]) ?? [];
}

/** One creator's payout history, newest month first. */
export async function listPayoutsForCreator(
  creatorId: string,
): Promise<UgcCreatorPayoutRow[]> {
  const serviceRole = createSupabaseServiceRoleClient();
  const { data, error } = await serviceRole
    .from("ugc_creator_payouts")
    .select("*")
    .eq("creator_id", creatorId)
    .order("period", { ascending: false })
    .order("payee", { ascending: true });

  if (error) {
    throw new Error(`Could not load payouts: ${error.message}`);
  }

  return (data as unknown as UgcCreatorPayoutRow[]) ?? [];
}

/** The months that have any payout recorded, newest first. */
export async function listPayoutPeriods(): Promise<PeriodKey[]> {
  const serviceRole = createSupabaseServiceRoleClient();
  const { data, error } = await serviceRole
    .from("ugc_creator_payouts")
    .select("period")
    .order("period", { ascending: false })
    .limit(1000);

  if (error) {
    throw new Error(`Could not load payout months: ${error.message}`);
  }

  return [
    ...new Set(((data ?? []) as Array<{ period: string }>).map((row) => periodOf(row.period))),
  ];
}
