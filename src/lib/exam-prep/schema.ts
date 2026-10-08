import { z } from "zod";

import { isDayKey, isValidTimeZone } from "./dates.ts";
import { GRADE_SCALE_IDS } from "./grade-scales.ts";
import { EXAM_TYPE_IDS } from "./model.ts";

export const EXAM_TITLE_MAX = 80;
export const EXAM_MAX_NOTES = 20;
export const EXAM_DAILY_MINUTES = [15, 30, 45, 60, 90] as const;
export const EXAM_MAX_DAYS_AHEAD = 365;

const uuid = z.string().uuid();

const title = z
  .string()
  .transform((value) => value.normalize("NFKC").replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(EXAM_TITLE_MAX));

const examDate = z.string().refine(isDayKey, { message: "Invalid date." });

const examFields = {
  title,
  examDate,
  examType: z.enum(EXAM_TYPE_IDS as [string, ...string[]]),
  gradeScale: z.enum(GRADE_SCALE_IDS as [string, ...string[]]),
  targetGrade: z.string().trim().min(1).max(16),
  targetPercent: z.number().gt(0).max(100),
  dailyMinutes: z.number().int().min(10).max(240),
  restDays: z.number().int().min(0).max(126),
  lectureIds: z.array(uuid).min(1).max(EXAM_MAX_NOTES),
};

export const createExamPlanSchema = z.object({
  ...examFields,
  timeZone: z.string().min(1).max(64).refine(isValidTimeZone, { message: "Invalid time zone." }),
});

export const updateExamPlanSchema = z
  .object({
    ...examFields,
    resultPercent: z.number().min(0).max(100).nullable(),
    resultGrade: z.string().trim().min(1).max(16).nullable(),
  })
  .partial();

export const examTaskCheckSchema = z.object({
  day: examDate,
  taskKey: z.string().min(1).max(120),
  done: z.boolean(),
});

/**
 * The `/creator` demo's notes have readable ids rather than uuids; everything
 * else about a plan is validated exactly as the real API does.
 */
const demoLectureIds = z.array(z.string().min(1).max(120)).min(1).max(EXAM_MAX_NOTES);
export const demoCreateExamPlanSchema = createExamPlanSchema.extend({ lectureIds: demoLectureIds });
export const demoUpdateExamPlanSchema = updateExamPlanSchema.extend({
  lectureIds: demoLectureIds.optional(),
});

export type CreateExamPlanInput = z.infer<typeof createExamPlanSchema>;
export type UpdateExamPlanInput = z.infer<typeof updateExamPlanSchema>;
