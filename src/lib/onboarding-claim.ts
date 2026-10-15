import { createClient } from "@supabase/supabase-js";

/**
 * Putting the survey answered before sign-in onto the account it was answered
 * for. Kept free of `server-only` and `next/headers` so the proxy can run it,
 * before any page renders (`supabase/middleware.ts`); the rest of the anonymous
 * survey lives in `onboarding-anonymous.ts`.
 */

/** Names the stored response; httpOnly, set by `POST /api/onboarding/anonymous`. */
export const ONBOARDING_RESPONSE_COOKIE = "memo-onboarding";

export type ClaimingUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

/**
 * Moves the stored response `responseId` onto `user`'s account, once.
 *
 * "claimed" when this call moved it, "gone" when there is nothing to move (it
 * was claimed already, or never existed), "failed" when the database could not
 * be asked, which is worth trying again on a later request. Never throws.
 */
export async function claimOnboardingResponse(
  responseId: string,
  user: ClaimingUser,
): Promise<"claimed" | "gone" | "failed"> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return "failed";
  }

  try {
    const name = user.user_metadata?.full_name ?? user.user_metadata?.name;
    const service = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await service.rpc("claim_onboarding_response", {
      response_id: responseId,
      claimant: user.id,
      claimant_email: user.email ?? null,
      claimant_name: typeof name === "string" ? name : null,
    });
    if (error) return "failed";
    return data === true ? "claimed" : "gone";
  } catch {
    return "failed";
  }
}
