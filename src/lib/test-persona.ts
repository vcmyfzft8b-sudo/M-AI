import type { UserEntitlementState } from "@/lib/billing";
import type { BillingSubscriptionRow } from "@/lib/database.types";

export const TEST_PERSONA_COOKIE = "memo-test-persona";

/**
 * A state the app can be asked to pretend it is in.
 *
 * Every screen that matters here — the onboarding, the paywall, the trial
 * prompts, the note that unlocks tools — is a screen you can only see from one
 * account state, and most of those states are ones you cannot get back to once
 * you have left them. Buying a subscription to check what a subscriber sees is
 * a real charge; getting back to "has never subscribed" afterwards is not
 * possible at all.
 *
 * So the state is faked rather than reached. Nothing here is written: no
 * profile is edited, no `billing_subscriptions` row is inserted, and Stripe is
 * neither called nor told anything. It is one cookie, read on the way out, and
 * only for the account `isSuperAdmin` names.
 */
export const TEST_PERSONA_BILLING = ["real", "free", "spent", "trialing", "paid"] as const;
export const TEST_PERSONA_ONBOARDING = ["real", "done", "pending"] as const;

export type TestPersonaBilling = (typeof TEST_PERSONA_BILLING)[number];
export type TestPersonaOnboarding = (typeof TEST_PERSONA_ONBOARDING)[number];

export type TestPersona = {
  billing: TestPersonaBilling;
  onboarding: TestPersonaOnboarding;
};

export const REAL_TEST_PERSONA: TestPersona = { billing: "real", onboarding: "real" };

export function isRealPersona(persona: TestPersona) {
  return persona.billing === "real" && persona.onboarding === "real";
}

export function parseTestPersona(value: string | null | undefined): TestPersona {
  if (!value) {
    return REAL_TEST_PERSONA;
  }

  const [billing, onboarding] = value.split(":");

  return {
    billing: (TEST_PERSONA_BILLING as readonly string[]).includes(billing)
      ? (billing as TestPersonaBilling)
      : "real",
    onboarding: (TEST_PERSONA_ONBOARDING as readonly string[]).includes(onboarding)
      ? (onboarding as TestPersonaOnboarding)
      : "real",
  };
}

export function serializeTestPersona(persona: TestPersona) {
  return `${persona.billing}:${persona.onboarding}`;
}

const MINUTE = 60 * 1000;

/**
 * A subscription that does not exist, shaped like one that does.
 *
 * Settings prints the plan, the status and the renewal date off this row, so a
 * persona that claims a subscription has to hand it something to print. The
 * Stripe ids say what it is in the one place anybody would look.
 */
function fabricatedSubscription(
  userId: string,
  status: "trialing" | "active",
): BillingSubscriptionRow {
  const now = new Date();

  return {
    id: "00000000-0000-4000-8000-0000000000ff",
    user_id: userId,
    stripe_customer_id: null,
    stripe_subscription_id: "sub_test_persona",
    stripe_price_id: null,
    plan: "yearly",
    status,
    currency: "eur",
    unit_amount: null,
    current_period_end: new Date(
      now.getTime() + (status === "trialing" ? 3 : 365) * 24 * 60 * MINUTE,
    ).toISOString(),
    cancel_at_period_end: false,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

/**
 * The entitlement the app should act on, with the persona applied.
 *
 * Written as a whole replacement of the fields a state implies rather than as a
 * patch of the one or two the screen under test happens to read — a persona
 * that says "has never subscribed" but leaves `hasConsumedTrial` true is a
 * state no real account is ever in, and testing against it teaches nothing.
 */
export function applyTestPersona(
  state: UserEntitlementState,
  persona: TestPersona,
  userId: string,
): UserEntitlementState {
  let next = state;

  if (persona.onboarding !== "real") {
    next = { ...next, onboardingComplete: persona.onboarding === "done" };
  }

  if (persona.billing === "real") {
    return next;
  }

  if (persona.billing === "paid" || persona.billing === "trialing") {
    const subscription = fabricatedSubscription(
      userId,
      persona.billing === "paid" ? "active" : "trialing",
    );

    return {
      ...next,
      subscription,
      subscriptions: [subscription],
      hasPaidAccess: true,
      // Somebody who is subscribed cannot start a free trial and has no free
      // note left to spend, because everything is open to them anyway.
      subscriptionTrialEligible: false,
      hasTrialLectureAvailable: false,
      canCreateNotes: true,
      canAccessPaywalledCreation: false,
      shouldShowTrialEntry: false,
    };
  }

  // Unpaid. `free` has its one free note still to spend; `spent` has used it,
  // which is the state the paywall actually exists for.
  const spent = persona.billing === "spent";

  return {
    ...next,
    subscription: null,
    subscriptions: [],
    hasPaidAccess: false,
    subscriptionTrialEligible: true,
    hasConsumedTrial: spent,
    hasTrialLectureAvailable: !spent,
    canResumeTrialLecture: false,
    // No half-made free note in either persona: `free` has not started one and
    // `spent` has finished one, so nothing is ever mid-run.
    trialLectureInProgress: false,
    canCreateNotes: !spent,
    canAccessPaywalledCreation: spent,
    shouldShowTrialEntry: true,
  };
}
