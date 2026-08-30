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
 * Exactly one spin per account. `discount_wheel_spun_at` is the latch; the
 * update below only matches rows where it is still null, so two taps racing
 * each other cannot award two prizes.
 */

/** The coupon every spin awards today. See the Stripe coupon of the same id. */
export const WHEEL_COUPON_ID = "memo50-first-cycle";
/** What the coupon is worth, for the copy the client renders. */
export const WHEEL_PRIZE_LABEL = "50 % popusta";

export type DiscountWheelState = {
  /** False once the wheel has been spun, whatever the outcome. */
  canSpin: boolean;
  /** The coupon this account has waiting, if any. */
  coupon: string | null;
  /** True while a won coupon has not yet been used at checkout. */
  hasUnredeemedPrize: boolean;
};

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

  return {
    canSpin: !row?.discount_wheel_spun_at,
    coupon: row?.discount_wheel_coupon ?? null,
    hasUnredeemedPrize: Boolean(row?.discount_wheel_coupon && !row.discount_wheel_redeemed_at),
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

  const { data, error } = await supabase
    .from("profiles")
    .update({
      discount_wheel_spun_at: new Date().toISOString(),
      discount_wheel_coupon: WHEEL_COUPON_ID,
    } as never)
    .eq("id", userId)
    .is("discount_wheel_spun_at", null)
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
