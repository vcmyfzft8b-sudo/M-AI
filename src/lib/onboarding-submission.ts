import { z } from "zod";

// Imported by its real filename so the Node test runner can load this module
// directly; it cannot resolve the "@/" alias. Same reason as `translate.ts`.
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
} from "./onboarding-options.ts";

/**
 * What a completed survey looks like on the wire.
 *
 * Shared by the two routes that accept one — `/api/profile/onboarding` for
 * someone who is signed in, `/api/onboarding/anonymous` for someone who is not
 * yet — so a new question cannot be accepted by one and silently dropped by
 * the other.
 */

const gradeSchema = z.number().min(1).max(10).nullish();

// Every answer is optional: the survey branches, so a step the user never saw
// stays null instead of being stored as its default value.
export const onboardingAnswersSchema = z.object({
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
// by either route. Restore it only alongside a step that actually asks.
export const onboardingSubmissionSchema = z.object({
  educationLevel: z.enum(["high_school", "university", "masters", "self_study", "other"]),
  currentAverageGrade: z.string().trim().min(1).max(40),
  targetGrade: z.string().trim().min(1).max(40),
  studyGoal: z.string().trim().min(1).max(240),
  answers: onboardingAnswersSchema.optional(),
});

export type OnboardingSubmission = z.infer<typeof onboardingSubmissionSchema>;
export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;

/** The request body limit both routes use. Twenty-odd short enum answers. */
export const ONBOARDING_MAX_BYTES = 8 * 1024;
