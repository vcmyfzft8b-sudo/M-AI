import "server-only";

import { cookies } from "next/headers";

import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { OnboardingSubmission } from "@/lib/onboarding-submission";

/**
 * The survey, answered before there is an account to attach it to.
 *
 * Two cookies carry the state across the sign-in hop, because that hop is a
 * full redirect through Supabase and back and nothing in the page survives it:
 *
 *   `memo-onboarding`  names the stored response, so the account that appears
 *                      on the other side can claim it. httpOnly — it is a
 *                      bearer for those answers and no script needs it.
 *   `memo-onboarded`   says only "this browser has been through the survey",
 *                      so a returning signed-out visitor is shown sign-in
 *                      rather than being asked everything a second time.
 *
 * A cookie rather than a query parameter deliberately: the response id would
 * otherwise sit in a URL, in history and in every referrer, for no benefit.
 */

export const ONBOARDING_RESPONSE_COOKIE = "memo-onboarding";
export const ONBOARDING_SEEN_COOKIE = "memo-onboarded";

/** Long enough to survive "I'll sign up tomorrow", short enough to expire. */
export const ONBOARDING_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export type OnboardingSource = "web" | "ios";

/**
 * Stores a response from someone with no account and returns its id.
 *
 * The row is kept whether or not they ever sign up — a completed survey from
 * someone who then walked away is the most useful thing the funnel produces,
 * and `claimed_by` staying null is what marks it as exactly that.
 */
export async function saveAnonymousOnboarding(
  submission: OnboardingSubmission,
  context: { source: OnboardingSource; locale: string | null },
): Promise<string> {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("onboarding_responses")
    .insert({
      source: context.source,
      locale: context.locale,
      education_level: submission.educationLevel,
      current_average_grade: submission.currentAverageGrade,
      target_grade: submission.targetGrade,
      study_goal: submission.studyGoal,
      answers: submission.answers ?? {},
    } as never)
    .select("id")
    .single<{ id: string }>();

  if (error || !data) throw new Error(error?.message ?? "Onboarding response not stored");
  return data.id;
}

/**
 * Moves a stored response onto the signed-in account, once.
 *
 * Called from `/app/start`, which is the screen every sign-in lands on and the
 * one that decides between "ask the survey" and "show the paywall" — so the
 * claim has to have happened before it reads the profile, or someone who just
 * answered everything would be asked all of it again.
 *
 * Returns whether anything was claimed. Never throws: an account arriving
 * without its answers is a worse experience, not a broken one, and the sign-in
 * it just completed must not fail because of it.
 */
export async function claimPendingOnboarding(): Promise<boolean> {
  const store = await cookies();
  const responseId = store.get(ONBOARDING_RESPONSE_COOKIE)?.value;
  if (!responseId) return false;

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    // `as never` on the name is the repo's convention for a function the
    // generated types do not carry; see `record_tutor_usage` and the rest.
    const { data } = await createSupabaseServiceRoleClient().rpc("claim_onboarding_response" as never, {
      response_id: responseId,
      claimant: user.id,
      claimant_email: user.email ?? null,
      claimant_name:
        typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name
          : typeof user.user_metadata?.name === "string"
            ? user.user_metadata.name
            : null,
    } as never);
    // False every time after the first. The cookie outlives the claim — a
    // Server Component cannot clear one — so this runs again on later visits
    // and does nothing, which is the point of doing it in the database.
    return data === true;
  } catch {
    return false;
  }
}

/** Whether this browser has already walked the survey, signed in or not. */
export async function hasSeenOnboarding(): Promise<boolean> {
  const store = await cookies();
  return store.has(ONBOARDING_SEEN_COOKIE) || store.has(ONBOARDING_RESPONSE_COOKIE);
}
