import "server-only";

import { getUserEntitlementState } from "@/lib/billing";
import { getLjubljanaUsageDate, hasUnlimitedTtsUsage } from "@/lib/note-tts";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  chargeableSeconds,
  computeTutorAllowance,
  dailySecondsFor,
  FREE_TUTOR_LIFETIME_SECONDS,
  PAID_TUTOR_DAILY_SECONDS,
  TUTOR_CREDIT_PACK_SECONDS,
  TUTOR_GRANT_KEY_GRACE_SECONDS,
  type TutorAllowance,
  type VoiceFeature,
} from "@/lib/tutor-allowance";

/**
 * How the voice tutor is metered.
 *
 * Read-aloud can count what it spends because the server synthesizes every second of it. The
 * tutor cannot: its audio is made in the browser, talking to Soniox directly, which is what
 * makes barge-in fast enough to be worth having. So it is metered at the door instead.
 *
 * The server hands out a slice of time at a time and mints the Soniox keys to expire when the
 * slice does — the learner physically cannot talk past their allowance, because the
 * credentials stop working. Each slice is recorded when issued and settled to what was
 * actually used when the client reports back. A client that never reports costs its caller
 * one slice, not the evening; a client that lies can only lie downwards, and only within a
 * slice it had already been granted.
 */

export {
  FREE_TUTOR_LIFETIME_SECONDS,
  PAID_TUTOR_DAILY_SECONDS,
  TUTOR_CREDIT_PACK_SECONDS,
  type TutorAllowance,
  type VoiceFeature,
};

export type TutorGrant = {
  grantId: string | null;
  grantedSeconds: number;
  keyTtlSeconds: number;
  allowance: TutorAllowance;
};

function service() {
  return createSupabaseServiceRoleClient();
}

/**
 * How long past its own window a grant is given before it is written off.
 *
 * A tab that is closed hard — the phone locked, the browser killed — never reports, and the
 * slice it reserved would otherwise hold the allowance down forever. After its window plus
 * this, it is charged at what it was granted and closed, which is the honest reading of "we
 * gave you the time and you never said otherwise".
 */
const GRANT_ABANDON_GRACE_SECONDS = 120;

/** Closes grants nobody is coming back for, charging them at what they reserved. */
async function sweepStaleGrants(userId: string) {
  const supabase = service();
  const { data } = await supabase
    .from("tutor_usage_grants")
    .select("id, usage_date, granted_seconds, source, feature, created_at")
    .eq("user_id", userId)
    .eq("status", "open");

  const stale = ((data ?? []) as Array<{
    id: string;
    usage_date: string;
    granted_seconds: number;
    source: "free" | "daily" | "credit";
    feature: VoiceFeature;
    created_at: string;
  }>).filter((grant) => {
    const expiresAt =
      new Date(grant.created_at).getTime() +
      (grant.granted_seconds + GRANT_ABANDON_GRACE_SECONDS) * 1000;

    return Number.isFinite(expiresAt) && expiresAt < Date.now();
  });

  for (const grant of stale) {
    const { error } = await supabase
      .from("tutor_usage_grants")
      .update({ charged_seconds: grant.granted_seconds, status: "settled" } as never)
      .eq("id", grant.id)
      .eq("status", "open");

    if (error) {
      continue;
    }

    await supabase.rpc("record_tutor_usage" as never, {
      target_user_id: userId,
      usage_day: grant.usage_date,
      seconds: grant.granted_seconds,
      from_credits: grant.source === "credit" ? grant.granted_seconds : 0,
      feature_key: grant.feature,
    } as never);
  }
}

/**
 * What this account may spend, and out of which pot.
 *
 * Free accounts are measured against a lifetime total; paid ones against the day, and then
 * against whatever they have bought. Credits are deliberately spent last: somebody who pays
 * monthly should get their included half hour before the thing they topped up with.
 */
export async function getTutorAllowance(
  userId: string,
  feature: VoiceFeature,
): Promise<TutorAllowance> {
  const entitlement = await getUserEntitlementState(userId);
  const hasPaidAccess = entitlement.hasPaidAccess;
  const hasUnlimitedUsage = hasUnlimitedTtsUsage(entitlement.profile?.email);

  if (hasUnlimitedUsage) {
    return computeTutorAllowance({
      feature,
      hasPaidAccess: true,
      hasUnlimitedUsage: true,
      lifetimeSeconds: 0,
      dailySeconds: 0,
      creditSeconds: 0,
      reservedSeconds: 0,
    });
  }

  const supabase = service();
  const usageDate = getLjubljanaUsageDate();

  // Anything abandoned is closed before the sums are read, so it lands in the rollups below.
  await sweepStaleGrants(userId);

  const [{ data: total }, { data: daily }, { data: credits }, { data: open }] = await Promise.all([
    supabase
      .from("tutor_usage_totals")
      .select("lifetime_seconds")
      .eq("user_id", userId)
      .eq("feature", feature)
      .maybeSingle(),
    supabase
      .from("tutor_daily_usage")
      .select("seconds_used")
      .eq("user_id", userId)
      .eq("usage_date", usageDate)
      .eq("feature", feature)
      .maybeSingle(),
    supabase.from("tutor_credit_balances").select("seconds_remaining").eq("user_id", userId).maybeSingle(),
    /*
     * A slice that has been handed out but not yet reported is spent as far as anyone
     * asking is concerned. Otherwise two tabs would each be told the whole allowance is
     * free, and both would be right until the first one finished.
     */
    supabase
      .from("tutor_usage_grants")
      .select("granted_seconds")
      .eq("user_id", userId)
      .eq("feature", feature)
      .eq("status", "open"),
  ]);

  return computeTutorAllowance({
    feature,
    hasPaidAccess,
    hasUnlimitedUsage: false,
    lifetimeSeconds: (total as { lifetime_seconds: number } | null)?.lifetime_seconds ?? 0,
    dailySeconds: (daily as { seconds_used: number } | null)?.seconds_used ?? 0,
    creditSeconds: (credits as { seconds_remaining: number } | null)?.seconds_remaining ?? 0,
    reservedSeconds: ((open ?? []) as Array<{ granted_seconds: number }>).reduce(
      (sum, grant) => sum + grant.granted_seconds,
      0,
    ),
  });
}

/**
 * Reserves the next slice of talking time, or refuses when there is none left.
 *
 * Returns a grant whose `keyTtlSeconds` is what the Soniox keys should be minted for. An
 * unlimited account gets a slice without a grant row — there is nothing to settle.
 */
export async function openTutorGrant(params: {
  userId: string;
  lectureId: string;
  feature: VoiceFeature;
}): Promise<TutorGrant | null> {
  const allowance = await getTutorAllowance(params.userId, params.feature);
  /*
   * The largest slice handed out at once is that feature's whole day.
   *
   * Granting in smaller pieces would mean renewing mid-session, and renewing means new Soniox
   * keys and new sockets, which is a hole in the middle of a sentence. What it costs is that an
   * abandoned session reserves the lot until it is settled, which is why `sweepStaleGrants`
   * exists: a grant that outlives its own window with nobody reporting is closed at what it was
   * granted, and the reservation stops being indefinite.
   */
  const sliceSeconds = dailySecondsFor(params.feature);

  if (allowance.hasUnlimitedUsage) {
    return {
      grantId: null,
      grantedSeconds: sliceSeconds,
      keyTtlSeconds: sliceSeconds + TUTOR_GRANT_KEY_GRACE_SECONDS,
      allowance,
    };
  }

  if (allowance.remainingSeconds <= 0) {
    return null;
  }

  const grantedSeconds = Math.min(allowance.remainingSeconds, sliceSeconds);
  const { data, error } = await service()
    .from("tutor_usage_grants")
    .insert({
      user_id: params.userId,
      lecture_id: params.lectureId,
      usage_date: getLjubljanaUsageDate(),
      granted_seconds: grantedSeconds,
      source: allowance.source,
      feature: params.feature,
    } as never)
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return {
    grantId: (data as { id: string }).id,
    grantedSeconds,
    keyTtlSeconds: grantedSeconds + TUTOR_GRANT_KEY_GRACE_SECONDS,
    allowance,
  };
}

/**
 * Settles a slice to what was actually spoken.
 *
 * Clamped to what was granted, so a client cannot report an hour against a five-minute slice,
 * and idempotent on the grant: a report that arrives twice — the page hidden, then closed —
 * charges once.
 */
export async function settleTutorGrant(params: {
  userId: string;
  grantId: string;
  secondsUsed: number;
  feature: VoiceFeature;
}): Promise<TutorAllowance> {
  const supabase = service();
  const { data } = await supabase
    .from("tutor_usage_grants")
    .select("id, user_id, usage_date, granted_seconds, source, feature, status")
    .eq("id", params.grantId)
    .eq("user_id", params.userId)
    .maybeSingle();

  const grant = data as {
    id: string;
    usage_date: string;
    granted_seconds: number;
    source: "free" | "daily" | "credit";
    feature: VoiceFeature;
    status: string;
  } | null;

  /*
   * The feature is read off the grant rather than passed in. A slice belongs to the ledger it
   * was taken from, and a caller that settled a podcast grant against the tutor's day would
   * hand the listener their time back and quietly charge somebody else's.
   */
  if (!grant || grant.status === "settled") {
    return getTutorAllowance(params.userId, params.feature);
  }

  const charged = chargeableSeconds(params.secondsUsed, grant.granted_seconds);

  const { error: updateError } = await supabase
    .from("tutor_usage_grants")
    .update({ charged_seconds: charged, status: "settled" } as never)
    .eq("id", grant.id)
    .eq("status", "open");

  if (updateError) {
    throw updateError;
  }

  if (charged > 0) {
    const { error } = await supabase.rpc("record_tutor_usage" as never, {
      target_user_id: params.userId,
      usage_day: grant.usage_date,
      seconds: charged,
      from_credits: grant.source === "credit" ? charged : 0,
      feature_key: grant.feature,
    } as never);

    if (error) {
      throw error;
    }
  }

  return getTutorAllowance(params.userId, params.feature);
}

/** Adds a purchased hour. Called from the Stripe webhook once payment has actually landed. */
export async function creditTutorSeconds(params: { userId: string; seconds: number }) {
  const { error } = await service().rpc("add_tutor_credit_seconds" as never, {
    target_user_id: params.userId,
    seconds: params.seconds,
  } as never);

  if (error) {
    throw error;
  }
}

export type TutorUsageForClient = {
  feature: VoiceFeature;
  remainingSeconds: number;
  limitSeconds: number;
  usedSeconds: number;
  creditSeconds: number;
  hasPaidAccess: boolean;
  hasUnlimitedUsage: boolean;
};

/**
 * The shape the meter reads. `Number.MAX_SAFE_INTEGER` would render as a nonsense number, so
 * an unlimited account is described by the flag and given zeroes to ignore.
 */
export function toClientUsage(allowance: TutorAllowance): TutorUsageForClient {
  if (allowance.hasUnlimitedUsage) {
    return {
      feature: allowance.feature,
      remainingSeconds: 0,
      limitSeconds: 0,
      usedSeconds: 0,
      creditSeconds: 0,
      hasPaidAccess: true,
      hasUnlimitedUsage: true,
    };
  }

  return {
    feature: allowance.feature,
    remainingSeconds: allowance.remainingSeconds,
    limitSeconds: allowance.limitSeconds,
    usedSeconds: allowance.usedSeconds,
    creditSeconds: allowance.creditSeconds,
    hasPaidAccess: allowance.hasPaidAccess,
    hasUnlimitedUsage: false,
  };
}
