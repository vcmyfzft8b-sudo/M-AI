import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiUser } from "@/lib/api-auth";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const onboardingSchema = z.object({
  ageRange: z.enum(["under_16", "16_18", "19_22", "23_29", "30_plus"]),
  educationLevel: z.enum(["high_school", "university", "masters", "self_study", "other"]),
  currentAverageGrade: z.string().trim().min(1).max(40),
  targetGrade: z.string().trim().min(1).max(40),
  studyGoal: z.string().trim().min(1).max(240),
});

export async function POST(request: Request) {
  const user = await getApiUser(request);

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:profile:onboarding:post",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, onboardingSchema, {
    maxBytes: 4 * 1024,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const service = createSupabaseServiceRoleClient();
  const { error } = await service
    .from("profiles")
    .upsert({
      id: user.id,
      email: user.email ?? null,
      full_name:
        typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name
          : typeof user.user_metadata?.name === "string"
            ? user.user_metadata.name
            : null,
      age_range: parsed.data.ageRange,
      education_level: parsed.data.educationLevel,
      current_average_grade: parsed.data.currentAverageGrade,
      target_grade: parsed.data.targetGrade,
      study_goal: parsed.data.studyGoal,
      onboarding_completed_at: new Date().toISOString(),
    } as never, { onConflict: "id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
