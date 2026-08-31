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

/** Thrown when the wheel is asked to award a prize it has nowhere to store. */
export class MissingDiscountWheelSchemaError extends Error {
  constructor() {
    super("Discount wheel columns are missing; run migration 0036.");
    this.name = "MissingDiscountWheelSchemaError";
  }
}

export type DiscountWheelState = {
  /** False once the wheel has been spun, whatever the outcome. */
  canSpin: boolean;
  /** The coupon this account has waiting, if any. */
  coupon: string | null;
  /** True while a won coupon is unused *and* still inside its ten minutes. */
  hasUnredeemedPrize: boolean;
  /** When the current prize lapses, for the countdown. Null when there is none. */
  prizeExpiresAt: string | null;
  /*
   * Whether today's spin has been used, as a plain fact — unlike `canSpin`,
   * which development deliberately relaxes so the flow can be replayed. The
   * home screen decides which card to show from this, so the card is the one
   * production would show even while the wheel is being re-spun locally.
   */
  spunToday: boolean;
};

/**
 * True when a failure is the database not having migration 0036's columns.
 *
 * Postgres answers 42703 for an unknown column; PostgREST answers PGRST204
 * when its own schema cache has never seen one. Either way the feature has no
 * storage behind it, which is a deployment state rather than a fault in the
 * request — so the wheel reports "nothing to offer" instead of throwing a 500
 * at somebody who only opened the home screen.
 */
function isMissingWheelSchema(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    Boolean(error.message?.includes("discount_wheel"))
  );
}

/*
 * A local stand-in for the profile row.
 *
 * The preview-bypass account has no row in `profiles`, so every write here
 * matches nothing and every read comes back empty: the wheel awards a prize
 * that vanishes, and checkout is told there is no coupon. That makes the one
 * flow nobody can test end to end the one that takes the money.
 *
 * In development the state falls back to this map when the database has no row
 * for the user. It lives for the life of the server process, which is exactly
 * as long as anyone testing needs it to, and it is unreachable in production —
 * `spinLimitEnforced()` is the same switch that lifts the daily limit.
 */
type DevWheelRow = {
  spunAt: string;
  coupon: string;
  spentAt: string | null;
};

/*
 * Hung off `globalThis` because a module-level map does not survive hot
 * reload: every edit gives the route a fresh module, the prize awarded a
 * moment ago disappears, and checkout is told there is no coupon — which looks
 * exactly like the discount being broken. The same reason Next's own guidance
 * puts dev singletons here.
 */
const devWheelStore = globalThis as typeof globalThis & {
  __memoDevWheelRows?: Map<string, DevWheelRow>;
};

const devWheelRows = (devWheelStore.__memoDevWheelRows ??= new Map<string, DevWheelRow>());

/** True when the two instants fall on the same UTC day. */
function isSameUtcDay(a: Date, b: Date) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Local development spins as often as you like.
 *
 * The whole flow — wheel, prize, countdown, offer, checkout — is one spin per
 * day in production, which makes it a flow nobody can look at twice in an
 * afternoon. This is the only place the rule is decided, so relaxing it here
 * relaxes it everywhere at once, and `NODE_ENV` is `production` on every
 * deployment including previews.
 */
function spinLimitEnforced() {
  return process.env.NODE_ENV !== "development";
}

/** True when a spin recorded at this instant still counts against today. */
function spentToday(spunAt: string | null, now: Date) {
  if (!spunAt || !spinLimitEnforced()) {
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
    // Locally the flow is worth looking at even with no storage behind it.
    if (!spinLimitEnforced()) {
      return {
        canSpin: true,
        coupon: null,
        hasUnredeemedPrize: false,
        prizeExpiresAt: null,
        spunToday: false,
      };
    }

    if (isMissingWheelSchema(error)) {
      return {
        canSpin: false,
        coupon: null,
        hasUnredeemedPrize: false,
        prizeExpiresAt: null,
        spunToday: false,
      };
    }

    throw error;
  }

  const row = (data ?? null) as {
    discount_wheel_spun_at: string | null;
    discount_wheel_coupon: string | null;
    discount_wheel_redeemed_at: string | null;
  } | null;

  const dev = !spinLimitEnforced();
  const devRow = dev && !row ? devWheelRows.get(userId) : undefined;

  const now = new Date();
  const spunAt = devRow?.spunAt ?? row?.discount_wheel_spun_at ?? null;
  const spunMs = spunAt ? Date.parse(spunAt) : Number.NaN;
  const expiresMs = Number.isFinite(spunMs) ? spunMs + WHEEL_PRIZE_TTL_MS : Number.NaN;
  const coupon = devRow?.coupon ?? row?.discount_wheel_coupon ?? null;
  const spentAt = devRow ? devRow.spentAt : (row?.discount_wheel_redeemed_at ?? null);
  const unused = Boolean(coupon) && !spentAt;
  const live = Number.isFinite(expiresMs) && expiresMs > now.getTime();

  // The honest daily fact, before development's relaxation is applied to it.
  const usedTodaysSpin = Boolean(spunAt) && isSameUtcDay(new Date(spunAt as string), now);

  return {
    canSpin: !spentToday(spunAt, now),
    coupon,
    hasUnredeemedPrize: unused && live,
    prizeExpiresAt: unused && live ? new Date(expiresMs).toISOString() : null,
    spunToday: usedTodaysSpin,
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

  const spin = supabase
    .from("profiles")
    .update({
      discount_wheel_spun_at: now.toISOString(),
      discount_wheel_coupon: WHEEL_COUPON_ID,
      // A new spin is a new prize, so it has not been used yet. Without this a
      // second day's win would arrive already spent.
      discount_wheel_redeemed_at: null,
    } as never)
    .eq("id", userId);

  const { data, error } = await (
    spinLimitEnforced()
      ? spin.or(`discount_wheel_spun_at.is.null,discount_wheel_spun_at.lt.${startOfDay}`)
      : spin
  )
    .select("discount_wheel_coupon")
    .maybeSingle();

  if (error) {
    /*
     * Development answers with the prize whatever the database says.
     *
     * The columns this writes to come from migration 0036, and an environment
     * that has not run it fails here with "column does not exist" — which puts
     * "the prize could not be saved" in front of anyone trying to look at the
     * flow. The bookkeeping is what breaks; the flow itself is worth seeing.
     */
    if (!spinLimitEnforced()) {
      return { coupon: WHEEL_COUPON_ID, label: WHEEL_PRIZE_LABEL, alreadySpun: false };
    }

    if (isMissingWheelSchema(error)) {
      throw new MissingDiscountWheelSchemaError();
    }

    throw error;
  }

  if (data) {
    return { coupon: WHEEL_COUPON_ID, label: WHEEL_PRIZE_LABEL, alreadySpun: false };
  }

  // Locally the signed-in account may be the preview bypass, which has no
  // profile row for the update to match. Record the prize in the process
  // instead, so the rest of the flow — the countdown, the offer, the coupon
  // checkout reads — behaves exactly as it will for a real account.
  if (!spinLimitEnforced()) {
    devWheelRows.set(userId, {
      spunAt: now.toISOString(),
      coupon: WHEEL_COUPON_ID,
      spentAt: null,
    });

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
 * Marks the prize spent.
 *
 * Two things end a prize and they end it the same way: a checkout that carried
 * the coupon, and the learner closing the offer without buying. The offer is
 * "now or not at all", so walking away from it has to cost the discount —
 * otherwise the ten-minute countdown is a bluff, and reopening the sheet or
 * going straight to /app/start would still be half price.
 *
 * The spin timestamp is left alone, so the wheel stays spent for the rest of
 * the day either way and comes back tomorrow.
 */
export async function markDiscountWheelSpent(userId: string) {
  const supabase = createSupabaseServiceRoleClient();

  const { error } = await supabase
    .from("profiles")
    .update({ discount_wheel_redeemed_at: new Date().toISOString() } as never)
    .eq("id", userId)
    .is("discount_wheel_redeemed_at", null);

  if (!spinLimitEnforced()) {
    const devRow = devWheelRows.get(userId);

    if (devRow && !devRow.spentAt) {
      devWheelRows.set(userId, { ...devRow, spentAt: new Date().toISOString() });
    }
  }

  // Never the reason a checkout fails: the session is already created by the
  // time this runs, and a purchase that succeeded must not report an error.
  if (error && !isMissingWheelSchema(error)) {
    throw error;
  }
}
