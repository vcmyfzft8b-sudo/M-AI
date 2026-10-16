import "server-only";

import { cookies } from "next/headers";

import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { ONBOARDING_RESPONSE_COOKIE, claimOnboardingResponse } from "@/lib/onboarding-claim";
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

export { ONBOARDING_RESPONSE_COOKIE };
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
 * The same claim for a page that only has the cookie to go on.
 *
 * The proxy makes the claim first, before any page or layout renders
 * (`supabase/middleware.ts`): done here, in a layout, it raced the page, which
 * read the profile at the same moment and asked the survey again of someone
 * who had just answered it. This stays as the fallback for a request on which
 * the proxy could not reach the database; it returns whether it moved anything.
 */
export async function claimPendingOnboarding(): Promise<boolean> {
  const store = await cookies();
  const responseId = store.get(ONBOARDING_RESPONSE_COOKIE)?.value;
  if (!responseId) return false;

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    return (await claimOnboardingResponse(responseId, user)) === "claimed";
  } catch {
    return false;
  }
}

/** Whether this browser has already walked the survey, signed in or not. */
export async function hasSeenOnboarding(): Promise<boolean> {
  const store = await cookies();
  return store.has(ONBOARDING_SEEN_COOKIE) || store.has(ONBOARDING_RESPONSE_COOKIE);
}
