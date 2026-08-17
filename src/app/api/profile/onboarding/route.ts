import { NextResponse } from "next/server";

import { onboardingPayloadSchema } from "@/lib/onboarding-options";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  const parsed = await parseJsonRequest(request, onboardingPayloadSchema, {
    maxBytes: 8 * 1024,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const answers = parsed.data.answers ?? {};

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
      age_range: null,
      education_level: parsed.data.educationLevel,
      current_average_grade: parsed.data.currentAverageGrade,
      target_grade: parsed.data.targetGrade,
      study_goal: parsed.data.studyGoal,
      onboarding_heard_from: answers.heardFrom ?? null,
      onboarding_audience: answers.audience ?? null,
      onboarding_role: answers.role ?? null,
      onboarding_school_level: answers.schoolLevel ?? null,
      onboarding_school_year: answers.schoolYear ?? null,
      onboarding_subject: answers.subject ?? null,
      onboarding_motivation: answers.motivation ?? null,
      onboarding_feature: answers.feature ?? null,
      onboarding_class_focus: answers.classFocus ?? null,
      onboarding_daily_goal: answers.dailyGoal ?? null,
      onboarding_current_average_grade: answers.currentAverageGrade ?? null,
      onboarding_target_grade: answers.targetGrade ?? null,
      onboarding_grade_scale: answers.gradeScale ?? null,
      onboarding_completed_at: new Date().toISOString(),
    } as never, { onConflict: "id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
