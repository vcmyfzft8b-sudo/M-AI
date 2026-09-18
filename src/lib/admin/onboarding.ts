import "server-only";

import { cache } from "react";

import { callRpc } from "@/lib/admin/db";
import {
  type BreakdownRow,
  type GradeGoal,
  type OnboardingBreakdown,
  ONBOARDING_QUESTIONS,
  toQuestionBreakdown,
} from "@/lib/admin/onboarding-questions";
import { type DateRange, rangeToTimestamps } from "@/lib/admin/ranges";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export type {
  GradeGoal,
  OnboardingAnswer,
  OnboardingBreakdown,
  OnboardingQuestion,
  OnboardingQuestionBreakdown,
} from "@/lib/admin/onboarding-questions";

const cachedBreakdown = cache(async (fromIso: string, toIso: string) => {
  const serviceRole = createSupabaseServiceRoleClient();

  const [breakdown, grades] = await Promise.all([
    callRpc(serviceRole, "admin_onboarding_breakdown", { p_from: fromIso, p_to: toIso }),
    callRpc(serviceRole, "admin_onboarding_grades", { p_from: fromIso, p_to: toIso }),
  ]);

  if (breakdown.error) {
    throw new Error(`Could not load the onboarding answers: ${breakdown.error.message}`);
  }

  if (grades.error) {
    throw new Error(`Could not load the grade goals: ${grades.error.message}`);
  }

  return {
    rows: (breakdown.data ?? []) as BreakdownRow[],
    grades: (grades.data ?? []).map((row): GradeGoal => ({
      scale: Number(row.grade_scale),
      respondents: Number(row.respondents ?? 0),
      averageCurrent: Number(row.average_current ?? 0),
      averageTarget: Number(row.average_target ?? 0),
      aimingHigher: Number(row.aiming_higher ?? 0),
    })),
  };
});

/** Every survey answer given inside the window, counted per question. */
export async function getOnboardingBreakdown(range: DateRange): Promise<OnboardingBreakdown> {
  const { fromIso, toIso } = rangeToTimestamps(range);
  const { rows, grades } = await cachedBreakdown(fromIso, toIso);

  const byQuestion = new Map<string, BreakdownRow[]>();

  for (const row of rows) {
    const list = byQuestion.get(row.question) ?? [];
    list.push(row);
    byQuestion.set(row.question, list);
  }

  const surveyRows = byQuestion.get("survey") ?? [];

  return {
    completed: surveyRows.reduce((sum, row) => sum + Number(row.respondents ?? 0), 0),
    surveyed: Number(
      surveyRows.find((row) => row.answer === "answered")?.respondents ?? 0,
    ),
    questions: ONBOARDING_QUESTIONS.map((question) =>
      toQuestionBreakdown(question, byQuestion.get(question.key) ?? []),
    ),
    grades,
  };
}
