import { z } from "zod";

import { EXAM_LESSON_KINDS, isValidDay, MOCK_DURATIONS } from "@/lib/exams/exam-model";
import { createSanitizedStringSchema } from "@/lib/validation";

const daySchema = z.string().refine(isValidDay, { message: "Invalid date." });

export const examCreateSchema = z.object({
  title: createSanitizedStringSchema({ trim: true, collapseWhitespace: true, minLength: 1, maxLength: 120 }),
  examDate: daySchema,
  targetMastery: z.number().int().min(50).max(100),
  dailyMinutes: z.number().int().min(5).max(240),
  examFormat: z.enum(["written", "oral", "both"]),
  examKind: z.enum(["midterm", "exam", "matura"]),
  gradingScale: z.enum(["uni_5_10", "school_1_5", "percent"]),
  passPercentage: z.number().int().min(1).max(100),
  lectureIds: z.array(z.string().uuid()).min(1).max(40),
});

export const examPatchSchema = z
  .object({
    actualGrade: createSanitizedStringSchema({ trim: true, maxLength: 12 }).nullable().optional(),
    archived: z.boolean().optional(),
    examDate: daySchema.optional(),
    title: createSanitizedStringSchema({ trim: true, collapseWhitespace: true, minLength: 1, maxLength: 120 }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." });

export const lessonQuerySchema = z.object({
  lectureId: z.string().uuid(),
  kind: z.enum(EXAM_LESSON_KINDS),
});

export const lessonResultSchema = z.object({
  lectureId: z.string().uuid(),
  kind: z.enum(EXAM_LESSON_KINDS),
  correct: z.number().int().min(0).max(100),
  total: z.number().int().min(0).max(100),
  difficulty: z.number().int().min(1).max(5).nullable(),
});

export const mockStartSchema = z.object({
  durationMinutes: z
    .number()
    .int()
    .refine((value) => (MOCK_DURATIONS as readonly number[]).includes(value)),
});

export const mockSubmitSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        selected: z.number().int().min(0).max(20).nullable().optional(),
        text: createSanitizedStringSchema({ multiline: true, trim: true, maxLength: 12000 })
          .or(z.literal(""))
          .optional(),
        unknown: z.boolean().optional(),
      }),
    )
    .max(40),
});

export const examIdParamsSchema = z.object({ id: z.string().uuid() });
export const mockParamsSchema = z.object({ id: z.string().uuid(), attemptId: z.string().uuid() });
