import "server-only";

import {
  LEARNER_PROFILE_COLUMNS,
  toLearnerProfile,
  type LearnerProfile,
  type LearnerProfileRow,
} from "@/lib/learner-profile";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * The learner's profile, or null — including when the read fails.
 *
 * Personalisation is a nicety and the answer is not: a profile lookup that
 * errors or times out must cost the tutor its manners, never its reply. That is
 * why this swallows rather than throws, and why every caller treats a null as
 * the ordinary case rather than a problem.
 */
export async function fetchLearnerProfile(userId: string): Promise<LearnerProfile | null> {
  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data } = await supabase
      .from("profiles")
      .select(LEARNER_PROFILE_COLUMNS)
      .eq("id", userId)
      .maybeSingle();

    return toLearnerProfile((data ?? null) as LearnerProfileRow | null);
  } catch (error) {
    console.warn("[chat] learner profile lookup failed; answering without it", error);
    return null;
  }
}
