import { z } from "zod";

import {
  EXAM_LESSON_KINDS,
  isValidDay,
  MAX_EXAM_MODULES,
  MAX_EXAM_TOPICS,
  MOCK_MINUTES,
  ORAL_MINUTES,
  TARGET_MAX,
  TARGET_MIN,
} from "@/lib/exams/exam-model";
import { createSanitizedStringSchema } from "@/lib/validation";

const daySchema = z.string().refine(isValidDay, { message: "Invalid date." });

export const examCreateSchema = z.object({
  title: createSanitizedStringSchema({ trim: true, collapseWhitespace: true, minLength: 1, maxLength: 120 }),
  examDate: daySchema,
  targetMastery: z.number().int().min(TARGET_MIN).max(TARGET_MAX),
  dailyMinutes: z.number().int().min(5).max(240),
  examFormat: z.enum(["written", "oral", "both"]),
  examKind: z.enum(["midterm", "exam", "matura"]),
  gradingScale: z.enum(["uni_5_10", "school_1_5", "percent"]),
  passPercentage: z.number().int().min(1).max(100),
  lectureIds: z.array(z.string().uuid()).min(1).max(MAX_EXAM_MODULES),
  schoolLevel: createSanitizedStringSchema({ trim: true, maxLength: 40 }).nullable().optional(),
  schoolYear: createSanitizedStringSchema({ trim: true, maxLength: 40 }).nullable().optional(),
  aiExpand: z.boolean().optional(),
  /** Of `lectureIds`, the ones uploaded in the setup: the prep's own material, kept out of the library. */
  materialLectureIds: z.array(z.string().uuid()).max(MAX_EXAM_MODULES).optional(),
  /** The plan as the learner left it on the review: the topics they kept, renamed or added. */
  topics: z
    .array(
      z.object({
        lectureId: z.string().uuid(),
        title: createSanitizedStringSchema({ trim: true, collapseWhitespace: true, minLength: 1, maxLength: 160 }),
        summary: createSanitizedStringSchema({ multiline: true, trim: true, maxLength: 2400 }),
        keyPoints: z.array(createSanitizedStringSchema({ trim: true, maxLength: 400 })).max(8),
        source: z.enum(["material", "added", "ai"]),
      }),
    )
    .max(MAX_EXAM_TOPICS)
    .optional(),
});

/** The setup's "Creating your study path": which notes, whether the AI may add topics, the level. */
export const examPlanSchema = z.object({
  lectureIds: z.array(z.string().uuid()).min(1).max(MAX_EXAM_MODULES),
  aiExpand: z.boolean(),
  schoolLevel: createSanitizedStringSchema({ trim: true, maxLength: 40 }).nullable(),
  schoolYear: createSanitizedStringSchema({ trim: true, maxLength: 40 }).nullable(),
});

export const topicWrittenCheckSchema = z.object({
  topicId: z.string().uuid(),
  // A fresh question's number is its stored serial, which keeps counting past 999.
  questionId: z.string().regex(/^(gen|x):[0-9a-f-]{36}:w\d{1,6}$/),
  typedAnswer: createSanitizedStringSchema({ multiline: true, trim: true, maxLength: 12000 }),
  declaredUnknown: z.boolean(),
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
  topicId: z.string().uuid(),
  kind: z.enum(EXAM_LESSON_KINDS),
  /** The topic's check ("Preverjanje"): a quiz asks `CHECK_QUIZ_SIZE` questions. */
  check: z.boolean().default(false),
});

export const lessonResultSchema = z.object({
  topicId: z.string().uuid(),
  kind: z.enum(EXAM_LESSON_KINDS),
  correct: z.number().int().min(0).max(100),
  total: z.number().int().min(0).max(100),
  difficulty: z.number().int().min(1).max(5).nullable(),
  /** The questions the lesson showed, so the next try of it draws others. */
  itemIds: z.array(z.string().regex(/^[A-Za-z0-9:_-]{1,100}$/)).max(40).optional(),
  /** Of those, the ones answered wrong: they stay open as knowledge gaps until answered right. */
  missedIds: z.array(z.string().regex(/^[A-Za-z0-9:_-]{1,100}$/)).max(40).optional(),
});

export const mockStartSchema = z
  .object({
    durationMinutes: z
      .number()
      .int()
      .min(ORAL_MINUTES.min)
      .max(MOCK_MINUTES.max)
      .refine((value) => value % 5 === 0),
    mode: z.enum(["written", "oral"]).default("written"),
    voice: createSanitizedStringSchema({ trim: true, maxLength: 40 }).nullable().optional(),
    vibe: z.enum(["strict", "friendly", "encouraging"]).nullable().optional(),
  })
  // Each mode has its own gauge: written 10–120 minutes, oral 5–30.
  .refine(
    (value) =>
      value.mode === "oral"
        ? value.durationMinutes <= ORAL_MINUTES.max
        : value.durationMinutes >= MOCK_MINUTES.min,
    { message: "Invalid duration for this mode.", path: ["durationMinutes"] },
  );

export const mockSubmitSchema = z.object({
  answers: z
    .array(
      z.object({
        // A note's own question (its id), or one written for a topic, fresh for a topic, or for this mock ("gen:…", "x:…").
        questionId: z.string().uuid().or(z.string().regex(/^(gen|x):[A-Za-z0-9:-]{1,100}$/)),
        selected: z.number().int().min(0).max(20).nullable().optional(),
        text: createSanitizedStringSchema({ multiline: true, trim: true, maxLength: 12000 })
          .or(z.literal(""))
          .optional(),
        unknown: z.boolean().optional(),
      }),
    )
    // A two-hour mock is about 47 questions (mockQuestionCounts).
    .max(80),
});

export const examIdParamsSchema = z.object({ id: z.string().uuid() });
export const mockParamsSchema = z.object({ id: z.string().uuid(), attemptId: z.string().uuid() });
