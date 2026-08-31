import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AUDIENCE_VALUES,
  CLASS_FOCUS_VALUES,
  DAILY_GOAL_VALUES,
  FEATURE_VALUES,
  GRADE_SCALES,
  HEARD_FROM_VALUES,
  MOTIVATION_VALUES,
  ROLE_VALUES,
  SCHOOL_LEVEL_VALUES,
  SCHOOL_YEAR_VALUES,
  SUBJECT_VALUES,
} from "@/lib/onboarding-options";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

const gradeSchema = z.number().min(1).max(10).nullish();

// Every answer is optional: the survey branches, so a step the user never saw
// stays null instead of being stored as its default value.
const answersSchema = z.object({
  heardFrom: z.enum(HEARD_FROM_VALUES).nullish(),
  audience: z.enum(AUDIENCE_VALUES).nullish(),
  role: z.enum(ROLE_VALUES).nullish(),
  schoolLevel: z.enum(SCHOOL_LEVEL_VALUES).nullish(),
  schoolYear: z.enum(SCHOOL_YEAR_VALUES).nullish(),
  subject: z.enum(SUBJECT_VALUES).nullish(),
  motivation: z.enum(MOTIVATION_VALUES).nullish(),
  feature: z.enum(FEATURE_VALUES).nullish(),
  classFocus: z.enum(CLASS_FOCUS_VALUES).nullish(),
  dailyGoal: z.enum(DAILY_GOAL_VALUES).nullish(),
  currentAverageGrade: gradeSchema,
  targetGrade: gradeSchema,
  gradeScale: z
    .union([z.literal(GRADE_SCALES[0]), z.literal(GRADE_SCALES[1])])
    .nullish(),
});

// The survey has no age question, so `age_range` is deliberately not written
// here. Restore it only alongside a step that actually asks.
const onboardingSchema = z.object({
  educationLevel: z.enum(["high_school", "university", "masters", "self_study", "other"]),
  currentAverageGrade: z.string().trim().min(1).max(40),
  targetGrade: z.string().trim().min(1).max(40),
  studyGoal: z.string().trim().min(1).max(240),
  answers: answersSchema.optional(),
});

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
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
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
