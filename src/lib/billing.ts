import "server-only";

import { NextResponse } from "next/server";
import { cache } from "react";
import Stripe from "stripe";
import { getAppleEntitlement } from "@/lib/mobile/apple";

import { PREVIEW_AUTH_BYPASS_USER_ID, getOptionalUserOrPreviewBypass } from "@/lib/auth";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { isPreviewPremiumEnabled } from "@/lib/preview-mode";
import { applyTestPersona } from "@/lib/test-persona";
import { readTestPersonaFor } from "@/lib/test-persona-server";
import type { BillingSubscriptionRow, ProfileRow } from "@/lib/database.types";
import { getServerEnv } from "@/lib/server-env";
import { resolveSiteOrigin } from "@/lib/site-url";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export type BillingPlan = "weekly" | "monthly" | "yearly";
export type PurchasableBillingPlan = Exclude<BillingPlan, "weekly">;
export type BillingRequiredCode =
  | "subscription_required"
  | "trial_exhausted"
  | "trial_chat_limit_reached";
export type EntitlementFeature = "study" | "quiz" | "practice_test" | "mindmap" | "chat";

type ClaimTrialLectureResult =
  | { allowed: true; mode: "paid" | "trial" }
  | { allowed: false; code: "profile_not_found" | "trial_exhausted" };

export type UserEntitlementState = {
  profile: ProfileRow | null;
  subscriptions: BillingSubscriptionRow[];
  subscription: BillingSubscriptionRow | null;
  hasPaidAccess: boolean;
  onboardingComplete: boolean;
  trialLectureId: string | null;
  hasConsumedTrial: boolean;
  hasTrialLectureAvailable: boolean;
  canResumeTrialLecture: boolean;
  /** A run is underway on the free note: no second one may start beside it. */
  trialLectureInProgress: boolean;
  trialChatMessagesUsed: number;
  trialChatMessagesRemaining: number;
  subscriptionTrialEligible: boolean;
  canCreateNotes: boolean;
  canAccessPaywalledCreation: boolean;
  shouldShowTrialEntry: boolean;
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);
const TRIAL_CHAT_MESSAGE_LIMIT = 5;
export const DEV_BILLING_OVERRIDE_COOKIE = "memo-dev-billing-override";

/*
 * The prices are the same everywhere Memo sells — one euro amount per plan,
 * charged by Stripe in EUR — so only the words around them change per
 * language, and they are carried as catalogue keys rather than as text.
 */
export const BILLING_PLANS: Record<
  BillingPlan,
  {
    id: BillingPlan;
    labelKey: MessageKey;
    cadenceKey: MessageKey;
    amount: number;
    displayAmount?: number;
    billingNoteKey?: MessageKey;
    annualizedAmount: number;
    blurbKey: MessageKey;
  }
> = {
  weekly: {
    id: "weekly",
    labelKey: "billing.plan.weekly",
    cadenceKey: "billing.cadence.week",
    amount: 10,
    annualizedAmount: 520,
    blurbKey: "billing.blurb.weekly",
  },
  monthly: {
    id: "monthly",
    labelKey: "billing.plan.monthly",
    cadenceKey: "billing.cadence.month",
    amount: 20,
    annualizedAmount: 240,
    blurbKey: "billing.blurb.monthly",
  },
  yearly: {
    id: "yearly",
    labelKey: "billing.plan.yearly",
    cadenceKey: "billing.cadence.month",
    amount: 130,
    // €130 a year is €10.83 a month, not €11. Rounding the headline up prices
    // the plan above what is actually charged, which is the one direction a
    // price must never be wrong in.
    displayAmount: 10.83,
    billingNoteKey: "billing.note.yearly",
    annualizedAmount: 130,
    blurbKey: "billing.blurb.yearly",
  },
};

export const PURCHASABLE_BILLING_PLAN_IDS = ["monthly", "yearly"] as const satisfies readonly PurchasableBillingPlan[];
export const PURCHASABLE_BILLING_PLANS = PURCHASABLE_BILLING_PLAN_IDS.map(
  (planId) => BILLING_PLANS[planId],
);

function subscriptionPeriodAllowsAccess(subscription: BillingSubscriptionRow, nowMs = Date.now()) {
  if (!subscription.current_period_end) {
    return true;
  }

  const periodEndMs = Date.parse(subscription.current_period_end);

  return Number.isFinite(periodEndMs) && periodEndMs > nowMs;
}

export function hasPaidAccess(subscription: BillingSubscriptionRow | null, nowMs = Date.now()) {
  return Boolean(
    subscription &&
      ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status) &&
      subscriptionPeriodAllowsAccess(subscription, nowMs),
  );
}

export function hasPriorSubscriptionHistory(
  profile: ProfileRow | null,
  subscriptions: BillingSubscriptionRow[],
) {
  return Boolean(profile?.subscription_trial_started_at || subscriptions.length > 0);
}

export async function hasStripeSubscriptionHistory(params: {
  stripe?: Stripe;
  customerId: string | null;
  email: string | null;
}) {
  const stripe = params.stripe ?? getStripeClient();
  const checkedCustomerIds = new Set<string>();

  async function customerHasSubscription(customerId: string) {
    if (checkedCustomerIds.has(customerId)) {
      return false;
    }

    checkedCustomerIds.add(customerId);
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 1,
    });

    return subscriptions.data.length > 0;
  }

  if (params.customerId && (await customerHasSubscription(params.customerId))) {
    return true;
  }

  if (!params.email) {
    return false;
  }

  let startingAfter: string | undefined;

  do {
    const customers = await stripe.customers.list({
      email: params.email,
      limit: 100,
      starting_after: startingAfter,
    });

    for (const customer of customers.data) {
      if (await customerHasSubscription(customer.id)) {
        return true;
      }
    }

    if (!customers.has_more || customers.data.length === 0) {
      break;
    }

    startingAfter = customers.data.at(-1)?.id;
  } while (startingAfter);

  return false;
}

export function getActiveSubscription(
  subscriptions: BillingSubscriptionRow[],
): BillingSubscriptionRow | null {
  const nowMs = Date.now();
  const sorted = [...subscriptions].sort((left, right) =>
    right.updated_at.localeCompare(left.updated_at),
  );

  return (
    sorted.find((subscription) => hasPaidAccess(subscription, nowMs)) ??
    sorted[0] ??
    null
  );
}

function hasCompletedOnboardingProfile(profile: ProfileRow | null) {
  return Boolean(
    profile?.onboarding_completed_at &&
      profile.education_level &&
      profile.current_average_grade &&
      profile.target_grade &&
      profile.study_goal,
  );
}

async function getSubscriptionsForUser(userId: string) {
  const { data } = await createSupabaseServiceRoleClient()
    .from("billing_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  return (data ?? []) as BillingSubscriptionRow[];
}

async function syncStripeSubscriptionsForCustomer(customerId: string) {
  const stripe = getStripeClient();
  let startingAfter: string | undefined;

  do {
    const page = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      starting_after: startingAfter,
    });

    for (const subscription of page.data) {
      await syncStripeSubscriptionRecord(subscription);
    }

    if (!page.has_more || page.data.length === 0) {
      break;
    }

    startingAfter = page.data.at(-1)?.id;
  } while (startingAfter);
}

async function resolveUserSubscriptionState(params: {
  userId: string;
  stripeCustomerId: string | null;
  subscriptions?: BillingSubscriptionRow[];
}) {
  let subscriptions = params.subscriptions ?? (await getSubscriptionsForUser(params.userId));
  let subscription = getActiveSubscription(subscriptions);

  if (!subscription && params.stripeCustomerId) {
    try {
      await syncStripeSubscriptionsForCustomer(params.stripeCustomerId);
      subscriptions = await getSubscriptionsForUser(params.userId);
      subscription = getActiveSubscription(subscriptions);
    } catch (error) {
      console.error("Stripe subscription reconciliation failed", {
        userId: params.userId,
        stripeCustomerId: params.stripeCustomerId,
        error,
      });
    }
  }

  return {
    subscriptions,
    subscription,
    hasPaidAccess: hasPaidAccess(subscription) || Boolean(await getAppleEntitlement(params.userId)),
  };
}

async function getTrialChatMessageUsage(userId: string, trialLectureId: string | null) {
  if (!trialLectureId) {
    return {
      trialChatMessagesUsed: 0,
      trialChatMessagesRemaining: TRIAL_CHAT_MESSAGE_LIMIT,
    };
  }

  const { count } = await createSupabaseServiceRoleClient()
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("lecture_id", trialLectureId)
    .eq("role", "user");

  const used = count ?? 0;
  return {
    trialChatMessagesUsed: used,
    trialChatMessagesRemaining: Math.max(TRIAL_CHAT_MESSAGE_LIMIT - used, 0),
  };
}

async function fetchProfileAndSubscriptions(userId: string) {
  const service = createSupabaseServiceRoleClient();
  const [{ data: profile }, { data: subscriptions }] = await Promise.all([
    service.from("profiles").select("*").eq("id", userId).maybeSingle(),
    service
      .from("billing_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
  ]);

  return {
    profile: (profile ?? null) as ProfileRow | null,
    subscriptions: (subscriptions ?? []) as BillingSubscriptionRow[],
  };
}

async function recoverTrialLectureForUser(params: {
  userId: string;
  profile: ProfileRow | null;
  hasPaidAccess: boolean;
}) {
  if (params.hasPaidAccess || !params.profile || params.profile.trial_lecture_id) {
    return params.profile;
  }

  const service = createSupabaseServiceRoleClient();
  const { data: orphanLectureData } = await service
    .from("lectures")
    .select("id, created_at, status")
    .eq("user_id", params.userId)
    .eq("access_tier", "trial")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const orphanLecture = orphanLectureData as
    | { id: string; created_at: string; status: string }
    | null;

  if (!orphanLecture) {
    return params.profile;
  }

  /*
   * Re-pointing the trial at a note the profile lost track of used to mark the trial spent at
   * the same time. It no longer does unless that note actually finished: the repair is about
   * which note holds the trial, and a repair must not decide a learner has had their free note
   * when the note in question never produced one.
   */
  const consumedAt =
    params.profile.trial_consumed_at ??
    (orphanLecture.status === "ready" ? orphanLecture.created_at : null);
  const repairedProfile = {
    ...params.profile,
    trial_lecture_id: orphanLecture.id,
    trial_started_at: params.profile.trial_started_at ?? orphanLecture.created_at,
    trial_consumed_at: consumedAt,
  };

  await service
    .from("profiles")
    .update({
      trial_lecture_id: repairedProfile.trial_lecture_id,
      trial_started_at: repairedProfile.trial_started_at,
      trial_consumed_at: repairedProfile.trial_consumed_at,
    } as never)
    .eq("id", params.userId);

  return repairedProfile;
}

/**
 * What the learner's free note is currently doing.
 *
 * `canResume` means the row is safe to hand a new source to: it exists, it never finished, and
 * nothing has been produced on it. `inProgress` is the other live case — a run is underway, so
 * the row must not be reused (a second source would overwrite the first) and the learner must not
 * be handed a second free note either, or two could finish and they would get two.
 *
 * A failed note is neither: since the trial is only spent when a note *succeeds*, a failure
 * leaves the learner free to start again.
 */
async function getTrialLectureState(params: {
  userId: string;
  trialLectureId: string | null;
  hasPaidAccess: boolean;
}): Promise<{ canResume: boolean; inProgress: boolean }> {
  if (params.hasPaidAccess || !params.trialLectureId) {
    return { canResume: false, inProgress: false };
  }

  const service = createSupabaseServiceRoleClient();
  const [{ data: lectureData }, { data: artifactData }, { count: transcriptCount }] = await Promise.all([
    service
      .from("lectures")
      .select("id, status")
      .eq("id", params.trialLectureId)
      .eq("user_id", params.userId)
      .maybeSingle(),
    service
      .from("lecture_artifacts")
      .select("lecture_id")
      .eq("lecture_id", params.trialLectureId)
      .maybeSingle(),
    service
      .from("transcript_segments")
      .select("id", { count: "exact", head: true })
      .eq("lecture_id", params.trialLectureId),
  ]);
  const lecture = lectureData as { id: string; status: string } | null;
  const artifact = artifactData as { lecture_id: string } | null;

  // Deleted, or finished, or failed: nothing live is holding the trial.
  if (!lecture || lecture.status === "ready" || lecture.status === "failed") {
    return { canResume: false, inProgress: false };
  }

  const untouched = !artifact && (transcriptCount ?? 0) === 0;

  return { canResume: untouched, inProgress: !untouched };
}
function buildEntitlementState(params: {
  profile: ProfileRow | null;
  subscriptions: BillingSubscriptionRow[];
  subscription: BillingSubscriptionRow | null;
  hasPaidAccess: boolean;
  canResumeTrialLecture: boolean;
  /** A run is underway on the free note: it can be neither reused nor joined by a second one. */
  trialLectureInProgress: boolean;
  trialChatMessagesUsed: number;
  trialChatMessagesRemaining: number;
  subscriptionTrialEligible: boolean;
}) {
  const onboardingComplete = hasCompletedOnboardingProfile(params.profile);
  const trialLectureId = params.profile?.trial_lecture_id ?? null;
  /*
   * The free note is spent when a note *succeeds*, and at no other moment.
   *
   * It used to be spent the instant the learner pressed create, which meant any attempt that
   * broke — a dropped upload, a source we could not read, a note they abandoned — took their one
   * free note with it. On 2026-09-06 that was 160 accounts blocked from creating anything,
   * having received nothing. `trial_consumed_at` is now stamped by a database trigger when a
   * lecture reaches `ready`, so it says what its name says.
   *
   * It stays stamped if the learner later deletes that note: they had their free note, and the
   * stamp outlives the row it came from. What a failure no longer does is spend anything.
   */
  const hasConsumedTrial = Boolean(params.profile?.trial_consumed_at);
  const hasTrialLectureAvailable =
    !params.hasPaidAccess && !hasConsumedTrial && !params.trialLectureInProgress;
  const canCreateNotes = params.hasPaidAccess || hasTrialLectureAvailable;
  const shouldShowTrialEntry = !params.hasPaidAccess;

  return {
    profile: params.profile,
    subscriptions: params.subscriptions,
    subscription: params.subscription,
    hasPaidAccess: params.hasPaidAccess,
    onboardingComplete,
    trialLectureId,
    hasConsumedTrial,
    hasTrialLectureAvailable,
    canResumeTrialLecture: params.canResumeTrialLecture,
    trialLectureInProgress: params.trialLectureInProgress,
    trialChatMessagesUsed: params.trialChatMessagesUsed,
    trialChatMessagesRemaining: params.trialChatMessagesRemaining,
    subscriptionTrialEligible: params.subscriptionTrialEligible,
    canCreateNotes,
    canAccessPaywalledCreation: !canCreateNotes,
    shouldShowTrialEntry,
  } satisfies UserEntitlementState;
}

export const getUserEntitlementState = cache(async function getUserEntitlementState(userId: string) {
  const { profile, subscriptions } = await fetchProfileAndSubscriptions(userId);
  const billingState = await resolveUserSubscriptionState({
    userId,
    stripeCustomerId: profile?.stripe_customer_id ?? null,
    subscriptions,
  });
  const recoveredProfile = await recoverTrialLectureForUser({
    userId,
    profile,
    hasPaidAccess: billingState.hasPaidAccess,
  });
  const [trialLectureState, trialUsage] = await Promise.all([
    getTrialLectureState({
      userId,
      trialLectureId: recoveredProfile?.trial_lecture_id ?? null,
      hasPaidAccess: billingState.hasPaidAccess,
    }),
    getTrialChatMessageUsage(
      userId,
      recoveredProfile?.trial_lecture_id ?? null,
    ),
  ]);
  const subscriptionTrialEligible = !hasPriorSubscriptionHistory(
    recoveredProfile,
    billingState.subscriptions,
  );

  const state = buildEntitlementState({
    profile: recoveredProfile,
    subscriptions: billingState.subscriptions,
    subscription: billingState.subscription,
    hasPaidAccess: billingState.hasPaidAccess,
    canResumeTrialLecture: trialLectureState.canResume,
    trialLectureInProgress: trialLectureState.inProgress,
    subscriptionTrialEligible,
    ...trialUsage,
  });

  /*
   * The one hook for the test-persona panel, and it is here rather than in
   * `getViewerAppState` on purpose: this is what the API routes read too, so a
   * persona that says "subscribed" gets past the entitlement checks as well as
   * past the paywall. Anything narrower would show a paid library and then
   * refuse to generate anything in it.
   *
   * It resolves to null for everybody except one confirmed account looking at
   * its own state — see `readTestPersonaFor`.
   */
  const persona = await readTestPersonaFor(userId);

  return persona ? applyTestPersona(state, persona, userId) : state;
});

/**
 * The definitive free-trial answer is only needed on the paywall. Keeping the
 * Stripe history lookup out of the base entitlement path means opening the
 * library, a note, settings, or help never waits on Stripe just to render UI
 * that does not use this field.
 */
export const getSubscriptionTrialEligibility = cache(
  async function getSubscriptionTrialEligibility(userId: string) {
    const entitlement = await getUserEntitlementState(userId);

    if (!entitlement.subscriptionTrialEligible) {
      return false;
    }

    /*
     * A persona's answer is the whole answer. Stripe remembers what this
     * account has really bought, and asking it here would put "Continue to
     * payment" on a paywall the persona is testing precisely because it should
     * read "Start 3-day free trial".
     */
    if (await readTestPersonaFor(userId)) {
      return true;
    }

    try {
      return !(await hasStripeSubscriptionHistory({
        customerId: entitlement.profile?.stripe_customer_id ?? null,
        email: entitlement.profile?.email ?? null,
      }));
    } catch (error) {
      console.error("Stripe subscription history check failed", {
        userId,
        error,
      });
      // Preserve the existing fail-open behavior. The checkout endpoint checks
      // Stripe again before it grants a trial, so a transient display-time
      // failure can never award a duplicate one.
      return true;
    }
  },
);

export const getViewerAppState = cache(async function getViewerAppState() {
  const user = await getOptionalUserOrPreviewBypass();

  if (!user) {
    return null;
  }

  const entitlement = await getUserEntitlementState(user.id);

  /*
   * The preview bypass signs in as an account with no profile row, so
   * `onboardingComplete` is false and the app layout bounces it to /app/start
   * before it can reach a single screen. Onboarding is not what anyone opens
   * the bypass to look at, so it counts as done for this one account.
   *
   * Nothing else is faked: it still has no subscription, so it sees exactly
   * what an unpaid account sees. And the bypass itself only exists when
   * PREVIEW_AUTH_BYPASS is set, which production is not.
   */
  if (user.id === PREVIEW_AUTH_BYPASS_USER_ID) {
    /*
     * ...and a subscription when the premium cookie is set, so the same
     * account can be flipped between the paywalled view and the paid one. It
     * is the entitlement that is faked, not a billing row: nothing is written,
     * and nothing about Stripe changes.
     */
    const previewPremium = await isPreviewPremiumEnabled();

    return {
      user,
      ...entitlement,
      onboardingComplete: true,
      ...(previewPremium
        ? {
            hasPaidAccess: true,
            canCreateNotes: true,
            canAccessPaywalledCreation: false,
            shouldShowTrialEntry: false,
            hasTrialLectureAvailable: false,
          }
        : {}),
    };
  }

  return {
    user,
    ...entitlement,
  };
});

/** App state for the paywall, including the one Stripe-only answer it shows. */
export const getViewerCheckoutState = cache(async function getViewerCheckoutState() {
  const appState = await getViewerAppState();

  if (!appState) {
    return null;
  }

  return {
    ...appState,
    subscriptionTrialEligible: await getSubscriptionTrialEligibility(appState.user.id),
  };
});

export function getPlanFromPriceId(priceId: string | null | undefined): BillingPlan | null {
  if (!priceId) {
    return null;
  }

  const env = getServerEnv();
  const match = (
    Object.entries({
      weekly: env.STRIPE_PRICE_WEEKLY,
      monthly: env.STRIPE_PRICE_MONTHLY,
      yearly: env.STRIPE_PRICE_YEARLY,
    }) as Array<[BillingPlan, string | undefined]>
  ).find(([, configuredPriceId]) => configuredPriceId === priceId);

  return match?.[0] ?? null;
}

export function getPriceIdForPlan(plan: BillingPlan) {
  const env = getServerEnv();

  const priceIdMap: Record<BillingPlan, string | undefined> = {
    weekly: env.STRIPE_PRICE_WEEKLY,
    monthly: env.STRIPE_PRICE_MONTHLY,
    yearly: env.STRIPE_PRICE_YEARLY,
  };

  const priceId = priceIdMap[plan];

  if (!priceId) {
    throw new Error(`Missing Stripe price id for ${plan}.`);
  }

  return priceId;
}

export function getStripeClient() {
  const env = getServerEnv();

  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }

  // Retried on network errors, 409s, 429s and 5xx, with an idempotency key the
  // SDK adds itself so a POST can never double up. The admin dashboard fans
  // its reads out across many small requests, and one transient failure among
  // them must not take the whole revenue view down.
  return new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });
}

/**
 * Slovenian invoice law wants the issuer's tax number and the reason VAT is not charged on the
 * document itself; Stripe prints only the trading name and address from the account settings, so
 * the rest rides along as the invoice footer. Set on the customer rather than through a Dashboard
 * invoice template, because templates are picked per invoice and never reach subscription renewals.
 * scripts/backfill-invoice-footer.mjs carries the same text for customers created before this.
 */
const INVOICE_FOOTER = [
  "Memo AI, Nace Valenčič s.p., poslovno svetovanje",
  "Zgoša 87, 4275 Begunje na Gorenjskem, Slovenija",
  "Matična številka: 7578474000 · Davčna številka: 52958248",
  "DDV ni obračunan na podlagi 1. odstavka 94. člena ZDDV-1.",
].join("\n");

export async function ensureStripeCustomer(params: {
  userId: string;
  email: string | null;
  fullName: string | null;
  existingCustomerId: string | null;
}) {
  if (params.existingCustomerId) {
    return params.existingCustomerId;
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email: params.email ?? undefined,
    name: params.fullName ?? undefined,
    invoice_settings: {
      footer: INVOICE_FOOTER,
    },
    metadata: {
      userId: params.userId,
    },
  });

  await createSupabaseServiceRoleClient()
    .from("profiles")
    .update({
      stripe_customer_id: customer.id,
    } as never)
    .eq("id", params.userId);

  return customer.id;
}

export async function syncStripeSubscription(subscriptionId: string) {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  await syncStripeSubscriptionRecord(subscription);

  return subscription;
}

export async function syncStripeSubscriptionRecord(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const item = subscription.items.data[0];
  const priceId = item?.price?.id ?? null;
  const plan = getPlanFromPriceId(priceId) ?? "monthly";
  const userId = subscription.metadata.userId || null;

  let resolvedUserId = userId;

  if (!resolvedUserId && customerId) {
    const { data: profile } = await createSupabaseServiceRoleClient()
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    resolvedUserId = ((profile as { id: string } | null)?.id ?? null);
  }

  if (!resolvedUserId) {
    throw new Error(`Unable to resolve user for Stripe subscription ${subscription.id}.`);
  }

  const service = createSupabaseServiceRoleClient();
  const profileUpdate: Record<string, string | null> = {
    stripe_customer_id: customerId,
  };

  if (subscription.trial_start) {
    profileUpdate.subscription_trial_started_at = new Date(
      subscription.trial_start * 1000,
    ).toISOString();
  }

  await service
    .from("profiles")
    .update(profileUpdate as never)
    .eq("id", resolvedUserId);

  await service
    .from("billing_subscriptions")
    .upsert(
      {
        user_id: resolvedUserId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        stripe_price_id: priceId,
        plan,
        status: subscription.status,
        currency: item?.price?.currency ?? "eur",
        unit_amount: item?.price?.unit_amount ?? null,
        current_period_end: item?.current_period_end
          ? new Date(item.current_period_end * 1000).toISOString()
          : null,
        cancel_at_period_end: subscription.cancel_at_period_end,
      } as never,
      { onConflict: "stripe_subscription_id" },
    );
}

type BillingRequestLike = {
  headers: Headers;
  nextUrl?: {
    origin?: string | null;
  };
};

export function getBillingSuccessUrl(request?: BillingRequestLike) {
  return `${resolveSiteOrigin(request)}/app/start?checkout=success`;
}

/**
 * Where Stripe sends a buyer who backed out.
 *
 * A checkout started from the prize wheel returns to the offer rather than to
 * the standard paywall: that buyer was shown a discounted price on a countdown,
 * and dropping them onto a full-price screen loses the thing they came for.
 * `offer=1` is what the home screen reads to reopen it.
 */
export function getBillingCancelUrl(request?: BillingRequestLike, fromOffer = false) {
  const origin = resolveSiteOrigin(request);

  return fromOffer
    ? `${origin}/app?checkout=cancelled&offer=1`
    : `${origin}/app/start?checkout=cancelled`;
}

export function getBillingPortalReturnUrl(request?: BillingRequestLike) {
  return `${resolveSiteOrigin(request)}/app/settings`;
}

export function getPaywallPath() {
  return "/app/start";
}

/**
 * `message` is written by the caller, which is inside a request and so knows
 * the reader's language; there is no sensible default sentence to fall back on
 * here, which is why it has none.
 */
export function createBillingRequiredResponse(
  message: string,
  code: BillingRequiredCode = "subscription_required",
) {
  return NextResponse.json(
    {
      error: message,
      code,
      redirectTo: getPaywallPath(),
    },
    { status: 402 },
  );
}

export async function hasPaidAccessForUserId(userId: string) {
  const entitlement = await getUserEntitlementState(userId);
  return entitlement.hasPaidAccess;
}

export async function canCreateLectureForUser(userId: string) {
  const entitlement = await getUserEntitlementState(userId);
  return entitlement.hasPaidAccess || entitlement.hasTrialLectureAvailable;
}

export async function claimTrialLecture(userId: string, lectureId: string) {
  const entitlement = await getUserEntitlementState(userId);

  if (entitlement.hasPaidAccess) {
    return {
      allowed: true,
      mode: "paid",
    } satisfies ClaimTrialLectureResult;
  }

  if (!entitlement.profile) {
    return {
      allowed: false,
      code: "profile_not_found",
    } satisfies ClaimTrialLectureResult;
  }

  /*
   * Claiming the free note marks which note holds it, and starts the clock — but it does not
   * spend it. `trial_consumed_at` is stamped by the database when a lecture reaches `ready`
   * (migration 0048), so an attempt that fails costs the learner nothing and they can try again.
   */
  if (entitlement.profile.trial_lecture_id === lectureId) {
    if (!entitlement.profile.trial_started_at) {
      await createSupabaseServiceRoleClient()
        .from("profiles")
        .update({
          trial_started_at: new Date().toISOString(),
        } as never)
        .eq("id", userId)
        .eq("trial_lecture_id", lectureId);
    }

    return {
      allowed: true,
      mode: "trial",
    } satisfies ClaimTrialLectureResult;
  }

  if (entitlement.profile.trial_consumed_at) {
    return {
      allowed: false,
      code: "trial_exhausted",
    } satisfies ClaimTrialLectureResult;
  }

  const service = createSupabaseServiceRoleClient();
  const claimedAt = new Date().toISOString();
  const previousTrialLectureId = entitlement.profile.trial_lecture_id;
  /*
   * The pointer moves to this note, and only the pointer.
   *
   * "Must still be null" was the old guard, and it cannot be the guard any more: an earlier
   * attempt that failed still owns the pointer, and taking it over from that attempt is exactly
   * what "a failure does not spend the free note" means. What replaces it is the value we read a
   * moment ago — so two requests racing to claim the free note still cannot both win, because
   * the loser's expected pointer no longer matches. Without that, two notes started in the same
   * second could both finish and the learner would get two free ones.
   *
   * `trial_consumed_at is null` stays alongside it, and is the condition that actually rations
   * the free note now that it is stamped only when one succeeds.
   */
  const claim = service
    .from("profiles")
    .update({
      trial_lecture_id: lectureId,
      trial_started_at: entitlement.profile.trial_started_at ?? claimedAt,
    } as never)
    .eq("id", userId)
    .is("trial_consumed_at", null);
  const { data: claimedProfile, error: claimError } = await (previousTrialLectureId
    ? claim.eq("trial_lecture_id", previousTrialLectureId)
    : claim.is("trial_lecture_id", null)
  )
    .select("id, trial_lecture_id")
    .maybeSingle();

  if (claimError) {
    throw claimError;
  }

  if (claimedProfile) {
    return {
      allowed: true,
      mode: "trial",
    } satisfies ClaimTrialLectureResult;
  }

  const { data: currentProfile, error: currentProfileError } = await service
    .from("profiles")
    .select("trial_lecture_id, trial_consumed_at")
    .eq("id", userId)
    .maybeSingle();

  if (currentProfileError) {
    throw currentProfileError;
  }

  if (
    (currentProfile as { trial_lecture_id: string | null; trial_consumed_at: string | null } | null)
      ?.trial_lecture_id === lectureId
  ) {
    return {
      allowed: true,
      mode: "trial",
    } satisfies ClaimTrialLectureResult;
  }

  return {
    allowed: false,
    code: "trial_exhausted",
  } satisfies ClaimTrialLectureResult;
}

export async function canUseLectureFeatures(
  userId: string,
  lectureId: string,
  feature: EntitlementFeature,
) {
  void feature;
  return canAccessLectureContent(userId, lectureId);
}

export async function canAccessLectureContent(userId: string, lectureId: string) {
  const entitlement = await getUserEntitlementState(userId);

  if (entitlement.hasPaidAccess) {
    return {
      allowed: true,
      entitlement,
    };
  }

  if (entitlement.trialLectureId === lectureId) {
    return {
      allowed: true,
      entitlement,
    };
  }

  return {
    allowed: false,
    code: "trial_exhausted" as const,
    entitlement,
  };
}

export async function canSendTrialChatMessage(userId: string, lectureId: string) {
  const lectureAccess = await canAccessLectureContent(userId, lectureId);

  if (!lectureAccess.allowed) {
    return {
      allowed: false,
      code: lectureAccess.code,
      entitlement: lectureAccess.entitlement,
    };
  }

  if (lectureAccess.entitlement.hasPaidAccess) {
    return lectureAccess;
  }

  if (lectureAccess.entitlement.trialChatMessagesRemaining <= 0) {
    return {
      allowed: false,
      code: "trial_chat_limit_reached" as const,
      entitlement: lectureAccess.entitlement,
    };
  }

  return lectureAccess;
}
