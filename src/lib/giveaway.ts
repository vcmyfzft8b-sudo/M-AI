import "server-only";

import { randomInt } from "node:crypto";

import { cookies } from "next/headers";
import Stripe from "stripe";

import { PREVIEW_AUTH_BYPASS_USER_ID } from "@/lib/auth";
import type { GiveawayCodeRow, GiveawayReferralRow } from "@/lib/database.types";
import {
  GIVEAWAY_CAMPAIGN,
  GIVEAWAY_COUPON_ID,
  GIVEAWAY_GOAL,
  GIVEAWAY_LEADERBOARD_SIZE,
  GIVEAWAY_REF_COOKIE,
  findGiveawayWinner,
  formatGiveawayCode,
  giveawaySeedEntries,
  rankGiveawayEntries,
  isGiveawayCodeFormat,
  maskGiveawayName,
  normalizeGiveawayCode,
  type GiveawayLeaderboard,
  type GiveawayRankedEntry,
} from "@/lib/giveaway-shared";
import { getServerEnv } from "@/lib/server-env";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * The back-to-school giveaway, server side.
 *
 * Three things live here and nowhere else:
 *
 *   - the personal code. One Stripe promotion code per account, on the same
 *     50 % coupon every other promotion uses, created the first time the
 *     giveaway screen is opened and never again;
 *   - attribution. When Stripe reports a subscription, the discount on it is
 *     matched against the codes we issued and a referral row is written for
 *     the account the code belongs to. It qualifies the moment the
 *     subscription is `active` — the one status that means money was
 *     collected, whether at checkout or when a trial converted;
 *   - the leaderboard, read through the SQL function that encodes the
 *     campaign's ordering rule, with names masked before they leave here.
 */

/** Thrown when the account's Stripe key is missing, so the screen can say so. */
export class GiveawayUnavailableError extends Error {
  constructor(message = "The giveaway is not configured on this deployment.") {
    super(message);
    this.name = "GiveawayUnavailableError";
  }
}

/**
 * Its own client rather than the one in billing: billing calls into this
 * module after every subscription sync, and importing it back would make the
 * two modules a cycle.
 */
function getStripe() {
  const env = getServerEnv();

  if (!env.STRIPE_SECRET_KEY) {
    throw new GiveawayUnavailableError();
  }

  return new Stripe(env.STRIPE_SECRET_KEY);
}

export type GiveawayCode = {
  code: string;
  stripePromotionCodeId: string;
};

export type GiveawayProgress = {
  qualifiedCount: number;
  pendingCount: number;
};

/**
 * A friend's code as the checkout route sees it: which promotion to attach
 * and who gets the credit.
 */
export type GiveawayReferral = {
  code: string;
  stripePromotionCodeId: string;
  referrerUserId: string;
  /** Masked, for "50 % off with Ana K.'s code". */
  referrerName: string;
};

/**
 * True when a failure is the database not having migration 0040's tables.
 *
 * Postgres answers 42P01 for an unknown relation and PostgREST PGRST205 when
 * its schema cache has never seen one. Either way the giveaway has no
 * storage behind it, which is a deployment state — the screens report an
 * empty board rather than a 500.
 */
function isMissingGiveawaySchema(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    Boolean(error.message?.includes("giveaway_"))
  );
}

/** Six draws from a CSPRNG; the alphabet and shape live in giveaway-shared. */
function drawGiveawayCode() {
  const draws: number[] = [];

  for (let index = 0; index < 6; index += 1) {
    draws.push(randomInt(0, 32));
  }

  return formatGiveawayCode(draws);
}

/**
 * The preview-bypass account has no profile row and no business creating
 * live Stripe objects from a developer's machine, so it gets a fixed code
 * that goes nowhere. The rest of the screen — progress, board, share sheet —
 * renders exactly as it does for a real account.
 */
const DEMO_CODE: GiveawayCode = {
  code: "BTS-SAMPLE",
  stripePromotionCodeId: "promo_demo",
};

export async function getGiveawayCode(userId: string): Promise<GiveawayCode | null> {
  if (userId === PREVIEW_AUTH_BYPASS_USER_ID) {
    return DEMO_CODE;
  }

  const { data, error } = await createSupabaseServiceRoleClient()
    .from("giveaway_codes")
    .select("code, stripe_promotion_code_id")
    .eq("user_id", userId)
    .eq("campaign", GIVEAWAY_CAMPAIGN)
    .maybeSingle();

  if (error) {
    if (isMissingGiveawaySchema(error)) {
      return null;
    }

    throw error;
  }

  const row = data as Pick<GiveawayCodeRow, "code" | "stripe_promotion_code_id"> | null;

  return row ? { code: row.code, stripePromotionCodeId: row.stripe_promotion_code_id } : null;
}

/**
 * The account's code, created on first call.
 *
 * The Stripe object is created before the row, under an idempotency key that
 * includes the code itself, so a retry of the same draw returns the same
 * promotion rather than a second one. If two requests race, the second
 * insert loses on the primary key: its promotion is switched off and the
 * winner's row is returned, so an account can never hold two live codes.
 */
export async function ensureGiveawayCode(params: {
  userId: string;
  email: string | null;
}): Promise<GiveawayCode> {
  const existing = await getGiveawayCode(params.userId);

  if (existing) {
    return existing;
  }

  const stripe = getStripe();
  const supabase = createSupabaseServiceRoleClient();

  // A drawn code can collide with a code Stripe already has — a creator's,
  // or another learner's. Stripe refuses the duplicate, and the next draw
  // is a different code. Three tries covers it many times over.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = drawGiveawayCode();
    let promotion: Stripe.PromotionCode;

    try {
      promotion = await stripe.promotionCodes.create(
        {
          code,
          promotion: { type: "coupon", coupon: GIVEAWAY_COUPON_ID },
          metadata: {
            // The same keys every other Memo promotion carries, so the
            // payout scripts and the Stripe dashboard filters keep working.
            app: "memo",
            billing_key: "pro",
            coupon_id: GIVEAWAY_COUPON_ID,
            promotion_code: code,
            campaign: GIVEAWAY_CAMPAIGN,
            referrer_user_id: params.userId,
            referrer_email: params.email ?? "",
          },
        },
        { idempotencyKey: `giveaway-${GIVEAWAY_CAMPAIGN}-${params.userId}-${code}` },
      );
    } catch (error) {
      const stripeError = error as { code?: string; type?: string };

      if (stripeError.code === "resource_already_exists" && attempt < 2) {
        continue;
      }

      throw error;
    }

    const { error } = await supabase.from("giveaway_codes").insert({
      user_id: params.userId,
      campaign: GIVEAWAY_CAMPAIGN,
      code,
      stripe_promotion_code_id: promotion.id,
      stripe_coupon_id: GIVEAWAY_COUPON_ID,
    } as never);

    if (!error) {
      return { code, stripePromotionCodeId: promotion.id };
    }

    if (isMissingGiveawaySchema(error)) {
      throw new GiveawayUnavailableError("Giveaway tables are missing; run migration 0040.");
    }

    // Lost a race with a concurrent request for the same account: keep the
    // row that won and retire the promotion this one made.
    const winner = await getGiveawayCode(params.userId);

    if (winner) {
      await stripe.promotionCodes.update(promotion.id, { active: false }).catch(() => undefined);

      return winner;
    }

    throw error;
  }

  throw new Error("Could not draw a unique giveaway code.");
}

/**
 * Locally the demo code resolves to a made-up owner, so a developer can
 * follow a friend's link through the paywall and checkout without a row in
 * the database. Unreachable in production and previews, where NODE_ENV is
 * `production`.
 */
const DEMO_CODE_OWNER = "00000000-0000-4000-8000-000000000002";

/** The issued code behind a string a friend brought, if it is one of ours. */
export async function findGiveawayCode(rawCode: string | null | undefined) {
  const code = normalizeGiveawayCode(rawCode);

  if (!isGiveawayCodeFormat(code)) {
    return null;
  }

  if (process.env.NODE_ENV === "development" && code === DEMO_CODE.code) {
    return {
      user_id: DEMO_CODE_OWNER,
      campaign: GIVEAWAY_CAMPAIGN,
      code,
      stripe_promotion_code_id: DEMO_CODE.stripePromotionCodeId,
      stripe_coupon_id: GIVEAWAY_COUPON_ID,
      created_at: new Date(0).toISOString(),
    } as GiveawayCodeRow;
  }

  const { data, error } = await createSupabaseServiceRoleClient()
    .from("giveaway_codes")
    .select("user_id, campaign, code, stripe_promotion_code_id, stripe_coupon_id, created_at")
    .eq("code", code)
    .eq("campaign", GIVEAWAY_CAMPAIGN)
    .maybeSingle();

  if (error) {
    if (isMissingGiveawaySchema(error)) {
      return null;
    }

    throw error;
  }

  return (data ?? null) as GiveawayCodeRow | null;
}

/** The giveaway code the visitor arrived with, if the cookie holds a well-formed one. */
export async function readGiveawayReferralCookie() {
  const store = await cookies();
  const code = normalizeGiveawayCode(store.get(GIVEAWAY_REF_COOKIE)?.value);

  return isGiveawayCodeFormat(code) ? code : null;
}

/**
 * Attaches a friend's code to the account, once.
 *
 * The cookie lives in one browser; the account outlives it. The first code
 * an account is seen with is kept — on the share link, on the paywall, at
 * checkout — so a purchase from another device, or after the cookie has
 * gone, still credits the friend. Never throws: this is bookkeeping beside
 * a request that must succeed anyway.
 */
export async function rememberGiveawayReferral(userId: string, code: string) {
  if (userId === PREVIEW_AUTH_BYPASS_USER_ID) {
    return;
  }

  const { error } = await createSupabaseServiceRoleClient()
    .from("profiles")
    .update({
      giveaway_referral_code: normalizeGiveawayCode(code),
      giveaway_referral_seen_at: new Date().toISOString(),
    } as never)
    .eq("id", userId)
    .is("giveaway_referral_code", null);

  if (error && !isMissingGiveawaySchema(error) && error.code !== "42703" && error.code !== "PGRST204") {
    console.error("[giveaway] could not remember referral", { userId, error });
  }
}

/** The friend's code the account was attached to earlier, if any. */
async function readRememberedGiveawayReferral(userId: string) {
  if (userId === PREVIEW_AUTH_BYPASS_USER_ID) {
    return null;
  }

  const { data, error } = await createSupabaseServiceRoleClient()
    .from("profiles")
    .select("giveaway_referral_code")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return null;
  }

  const code = normalizeGiveawayCode(
    (data as { giveaway_referral_code: string | null } | null)?.giveaway_referral_code,
  );

  return isGiveawayCodeFormat(code) ? code : null;
}

/**
 * Turns a friend's code into something checkout can attach.
 *
 * The cookie is read first; when it carries a code the account is attached
 * to it (first code wins). Without a cookie the account's remembered code is
 * used instead, which is what lets a purchase from another device still
 * credit the friend.
 *
 * Returns null when there is no code, the code is unknown, or it belongs to
 * the viewer — buying with your own code is not bringing a friend, and the
 * discount would be a self-serve 50 % off that the campaign never offered.
 */
export async function resolveGiveawayReferral(
  viewerUserId: string,
  rawCode?: string | null,
): Promise<GiveawayReferral | null> {
  const fromCookie = rawCode === undefined ? await readGiveawayReferralCookie() : rawCode;
  const code = fromCookie ?? (await readRememberedGiveawayReferral(viewerUserId));

  if (!code) {
    return null;
  }

  const row = await findGiveawayCode(code);

  if (!row || row.user_id === viewerUserId) {
    return null;
  }

  if (fromCookie) {
    await rememberGiveawayReferral(viewerUserId, row.code);
  }

  const { data: profile } = await createSupabaseServiceRoleClient()
    .from("profiles")
    .select("full_name, email")
    .eq("id", row.user_id)
    .maybeSingle();
  const referrer = (profile ?? null) as { full_name: string | null; email: string | null } | null;

  return {
    code: row.code,
    stripePromotionCodeId: row.stripe_promotion_code_id,
    referrerUserId: row.user_id,
    referrerName: maskGiveawayName(referrer?.full_name, referrer?.email, ""),
  };
}

export async function getGiveawayProgress(userId: string): Promise<GiveawayProgress> {
  if (userId === PREVIEW_AUTH_BYPASS_USER_ID) {
    return { qualifiedCount: 0, pendingCount: 0 };
  }

  const { data, error } = await createSupabaseServiceRoleClient()
    .from("giveaway_referrals")
    .select("status")
    .eq("campaign", GIVEAWAY_CAMPAIGN)
    .eq("referrer_user_id", userId);

  if (error) {
    if (isMissingGiveawaySchema(error)) {
      return { qualifiedCount: 0, pendingCount: 0 };
    }

    throw error;
  }

  const rows = (data ?? []) as Array<Pick<GiveawayReferralRow, "status">>;

  return {
    qualifiedCount: rows.filter((row) => row.status === "qualified").length,
    pendingCount: rows.filter((row) => row.status === "pending").length,
  };
}

/**
 * The standings, masked and ready to send.
 *
 * `fallbackName` is the already translated label for an account with neither
 * a name nor a usable address. The viewer is not marked: their own row looks
 * like everyone else's.
 */
export async function getGiveawayLeaderboard(params: {
  fallbackName: string;
  limit?: number;
}): Promise<GiveawayLeaderboard> {
  // `as never`, the way every other RPC here is called: the generated client
  // types do not pick the function up from `Database["public"]["Functions"]`.
  const { data, error } = await createSupabaseServiceRoleClient().rpc(
    "giveaway_leaderboard" as never,
    {
      p_campaign: GIVEAWAY_CAMPAIGN,
      p_goal: GIVEAWAY_GOAL,
      p_limit: params.limit ?? GIVEAWAY_LEADERBOARD_SIZE,
    } as never,
  );

  if (error && !isMissingGiveawaySchema(error)) {
    throw error;
  }

  const rows = (data ?? []) as Array<{
    user_id: string;
    full_name: string | null;
    email: string | null;
    qualified_count: number;
    latest_qualified_at: string | null;
    reached_goal_at: string | null;
  }>;

  const real: GiveawayRankedEntry[] = rows.map((row) => ({
    name: maskGiveawayName(row.full_name, row.email, params.fallbackName),
    qualifiedCount: Number(row.qualified_count),
    reachedGoalAt: row.reached_goal_at,
    latestQualifiedAt: row.latest_qualified_at,
  }));

  // The seeded field fills the board until real accounts pass it; a real
  // account with the same count always sits above a seed.
  const entries = rankGiveawayEntries(
    [...real, ...giveawaySeedEntries()],
    params.limit ?? GIVEAWAY_LEADERBOARD_SIZE,
  );

  return {
    campaign: GIVEAWAY_CAMPAIGN,
    goal: GIVEAWAY_GOAL,
    entries,
    winner: findGiveawayWinner(entries),
    updatedAt: new Date().toISOString(),
  };
}

/** The promotion-code ids on a subscription, expanding when the webhook only sent ids. */
async function promotionCodeIdsOn(subscription: Stripe.Subscription) {
  const discounts = subscription.discounts ?? [];

  if (discounts.length === 0) {
    return [];
  }

  const expanded = discounts.every((discount) => typeof discount !== "string")
    ? (discounts as Stripe.Discount[])
    : (
        await getStripe().subscriptions.retrieve(subscription.id, {
          expand: ["discounts"],
        })
      ).discounts.filter((discount): discount is Stripe.Discount => typeof discount !== "string");

  return expanded
    .map((discount) =>
      typeof discount.promotion_code === "string"
        ? discount.promotion_code
        : (discount.promotion_code?.id ?? null),
    )
    .filter((id): id is string => Boolean(id));
}

/**
 * Files a subscription under the giveaway code it was bought with, and marks
 * it qualified once Stripe says it is active.
 *
 * Called from the subscription sync after every webhook, so it has to be
 * cheap on the common path: a subscription with no discount costs nothing,
 * and one that already has a row costs one select. It never throws — a
 * failure here is logged and must not fail the billing sync that called it.
 */
export async function recordGiveawayReferral(
  subscription: Stripe.Subscription,
  buyerUserId: string | null,
) {
  try {
    await recordGiveawayReferralOrThrow(subscription, buyerUserId);
  } catch (error) {
    console.error("[giveaway] referral attribution failed", {
      subscriptionId: subscription.id,
      error,
    });
  }
}

async function recordGiveawayReferralOrThrow(
  subscription: Stripe.Subscription,
  buyerUserId: string | null,
) {
  if ((subscription.discounts ?? []).length === 0) {
    return;
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data: existingData, error: existingError } = await supabase
    .from("giveaway_referrals")
    .select("id, status, referred_user_id")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();

  if (existingError) {
    if (isMissingGiveawaySchema(existingError)) {
      return;
    }

    throw existingError;
  }

  const existing = existingData as Pick<
    GiveawayReferralRow,
    "id" | "status" | "referred_user_id"
  > | null;
  const isActive = subscription.status === "active";
  const now = new Date().toISOString();

  if (existing) {
    const update: Record<string, string | null> = {};

    if (existing.status === "pending" && isActive) {
      update.status = "qualified";
      update.qualified_at = now;
    }

    if (!existing.referred_user_id && buyerUserId) {
      update.referred_user_id = buyerUserId;
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from("giveaway_referrals")
        .update(update as never)
        .eq("id", existing.id);

      if (error) {
        throw error;
      }
    }

    return;
  }

  const promotionIds = await promotionCodeIdsOn(subscription);

  if (promotionIds.length === 0) {
    return;
  }

  const { data: codeData, error: codeError } = await supabase
    .from("giveaway_codes")
    .select("user_id, stripe_promotion_code_id")
    .eq("campaign", GIVEAWAY_CAMPAIGN)
    .in("stripe_promotion_code_id", promotionIds)
    .limit(1)
    .maybeSingle();

  if (codeError) {
    throw codeError;
  }

  const code = codeData as Pick<GiveawayCodeRow, "user_id" | "stripe_promotion_code_id"> | null;

  // Not one of ours, or the account's own code: no referral.
  if (!code || code.user_id === buyerUserId) {
    return;
  }

  const { error } = await supabase.from("giveaway_referrals").insert({
    campaign: GIVEAWAY_CAMPAIGN,
    referrer_user_id: code.user_id,
    referred_user_id: buyerUserId,
    stripe_subscription_id: subscription.id,
    stripe_promotion_code_id: code.stripe_promotion_code_id,
    status: isActive ? "qualified" : "pending",
    qualified_at: isActive ? now : null,
  } as never);

  // 23505 is the partial unique index: this friend has already been counted
  // once for the campaign, and a second subscription is not a second friend.
  if (error && error.code !== "23505") {
    throw error;
  }
}
