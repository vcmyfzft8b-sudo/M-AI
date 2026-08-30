import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * The one-shot prize wheel on the home screen.
 *
 * The wheel is theatre with a fixed outcome: every spin lands on 50 % off, the
 * `memo50-first-cycle` coupon that already exists in Stripe (50 % off, applied
 * once, to the first billing cycle). Keeping the prize server-side matters
 * anyway — the coupon must not be something a client can name for itself.
 *
 * One spin per day, not one per account. `discount_wheel_spun_at` records the
 * last spin and the day it fell on decides whether another is allowed, so the
 * offer comes back tomorrow rather than being gone forever.
 *
 * The day is UTC. A local day would need the browser's timezone, which is a
 * value the client controls — and a spin limit a client can move is not a
 * limit. UTC costs some users a few hours of drift and costs nobody a spin.
 */

/** The coupon every spin awards today. See the Stripe coupon of the same id. */
export const WHEEL_COUPON_ID = "memo50-first-cycle";
/** What the coupon is worth, for the copy the client renders. */
export const WHEEL_PRIZE_LABEL = "50 % popusta";

/**
 * How long a won prize stays usable. The offer is meant to be taken now, and a
 * countdown that the server does not enforce is decoration — so the window is
 * measured from the recorded spin and checked again when checkout asks for the
 * coupon, not just while the sheet is open.
 *
 * With one spin a day, letting it lapse also costs the day: the wheel will not
 * turn again until tomorrow, so closing the offer and coming back an hour later
 * finds nothing waiting.
 */
export const WHEEL_PRIZE_TTL_MS = 10 * 60 * 1000;

export type DiscountWheelState = {
  /** False once the wheel has been spun, whatever the outcome. */
  canSpin: boolean;
  /** The coupon this account has waiting, if any. */
  coupon: string | null;
  /** True while a won coupon is unused *and* still inside its ten minutes. */
  hasUnredeemedPrize: boolean;
  /** When the current prize lapses, for the countdown. Null when there is none. */
  prizeExpiresAt: string | null;
};

/** True when the two instants fall on the same UTC day. */
function isSameUtcDay(a: Date, b: Date) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** True when a spin recorded at this instant still counts against today. */
function spentToday(spunAt: string | null, now: Date) {
  if (!spunAt) {
    return false;
  }

  const spun = new Date(spunAt);

  return Number.isFinite(spun.getTime()) && isSameUtcDay(spun, now);
}

export async function getDiscountWheelState(userId: string): Promise<DiscountWheelState> {
  const supabase = createSupabaseServiceRoleClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("discount_wheel_spun_at, discount_wheel_coupon, discount_wheel_redeemed_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const row = (data ?? null) as {
    discount_wheel_spun_at: string | null;
    discount_wheel_coupon: string | null;
    discount_wheel_redeemed_at: string | null;
  } | null;

  const now = new Date();
  const spunAt = row?.discount_wheel_spun_at ?? null;
  const spunMs = spunAt ? Date.parse(spunAt) : Number.NaN;
  const expiresMs = Number.isFinite(spunMs) ? spunMs + WHEEL_PRIZE_TTL_MS : Number.NaN;
  const unused = Boolean(row?.discount_wheel_coupon) && !row?.discount_wheel_redeemed_at;
  const live = Number.isFinite(expiresMs) && expiresMs > now.getTime();

  return {
    canSpin: !spentToday(spunAt, now),
    coupon: row?.discount_wheel_coupon ?? null,
    hasUnredeemedPrize: unused && live,
    prizeExpiresAt: unused && live ? new Date(expiresMs).toISOString() : null,
  };
}

/**
 * Records the single spin and returns the prize. Returns the already-awarded
 * coupon rather than failing when the wheel was spun before, so a client that
 * retries gets the same answer instead of an error.
 */
export async function spinDiscountWheel(userId: string): Promise<{
  coupon: string;
  label: string;
  alreadySpun: boolean;
}> {
  const supabase = createSupabaseServiceRoleClient();
  const now = new Date();
  // Yesterday's spin no longer blocks today's, so the latch is "not spun since
  // midnight UTC" rather than "never spun". Still one statement, so two taps
  // racing each other still cannot award two prizes.
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();

  const { data, error } = await supabase
    .from("profiles")
    .update({
      discount_wheel_spun_at: now.toISOString(),
      discount_wheel_coupon: WHEEL_COUPON_ID,
    } as never)
    .eq("id", userId)
    .or(`discount_wheel_spun_at.is.null,discount_wheel_spun_at.lt.${startOfDay}`)
    .select("discount_wheel_coupon")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return { coupon: WHEEL_COUPON_ID, label: WHEEL_PRIZE_LABEL, alreadySpun: false };
  }

  // The latch was already set: report the prize that spin awarded.
  const state = await getDiscountWheelState(userId);

  return {
    coupon: state.coupon ?? WHEEL_COUPON_ID,
    label: WHEEL_PRIZE_LABEL,
    alreadySpun: true,
  };
}

/**
 * Marks the prize used. Called when a checkout session that carries the coupon
 * is created, so the discount is attached to one purchase and not to every
 * later one.
 */
export async function markDiscountWheelRedeemed(userId: string) {
  const supabase = createSupabaseServiceRoleClient();

  const { error } = await supabase
    .from("profiles")
    .update({ discount_wheel_redeemed_at: new Date().toISOString() } as never)
    .eq("id", userId)
    .is("discount_wheel_redeemed_at", null);

  if (error) {
    throw error;
  }
}
