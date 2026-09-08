import { NextResponse } from "next/server";
import { z } from "zod";

import { canAccessLectureContent, createBillingRequiredResponse } from "@/lib/billing";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { captureRouteError } from "@/lib/monitoring";
import { isMissingLectureReferenceError } from "@/lib/postgres-errors";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

const STUDY_SESSION_MAX_BYTES = 128 * 1024;

const flashcardConfidenceSchema = z.enum(["again", "good", "easy"]);

const flashcardStateSchema = z.object({
  reviewQueue: z.array(z.string()),
  repeatQueue: z.array(z.string()),
  activeFlashcardIndex: z.number().int().min(0).default(0),
  reviewCycle: z.number().int().min(1),
  cycleCardCount: z.number().int().min(0),
  roundSummary: z
    .object({
      cycle: z.number().int().min(1),
      total: z.number().int().min(0),
      known: z.number().int().min(0),
      missed: z.number().int().min(0),
    })
    .nullable(),
  sessionResults: z.record(
    z.string(),
    z.object({
      attempts: z.number().int().min(1),
      firstConfidence: flashcardConfidenceSchema,
      latestConfidence: flashcardConfidenceSchema,
    }),
  ),
});

const quizStateSchema = z.object({
  quizQueue: z.array(z.string()),
  quizRound: z.number().int().min(1),
  quizRoundCount: z.number().int().min(0),
  roundSummary: z
    .object({
      cycle: z.number().int().min(1),
      total: z.number().int().min(0),
      correct: z.number().int().min(0),
      missed: z.number().int().min(0),
      missedQuestionIds: z.array(z.string()),
    })
    .nullable(),
  activeQuestionIndex: z.number().int().min(0),
  selections: z.record(z.string(), z.number().int().min(0)),
  optionOrders: z.record(z.string(), z.array(z.number().int().min(0))),
});

const practiceTestStateSchema = z.object({
  currentAttemptId: z.string().uuid().nullable(),
  attemptQuestionIds: z.array(z.string().uuid()),
  textAnswers: z.record(z.string(), z.string()),
  unknownQuestionIds: z.array(z.string()),
  latestViewedAttemptId: z.string().uuid().nullable(),
  submittedAt: z.string().datetime().nullable(),
});

const updateStudySessionSchema = z.object({
  activeStudyView: z.enum(["flashcards", "quiz", "practice_test"]),
  flashcardState: flashcardStateSchema.nullable(),
  quizState: quizStateSchema.nullable(),
  practiceTestState: practiceTestStateSchema.nullable(),
});

async function updateStudySession(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:study-session:write",
    rules: rateLimitPresets.studySession,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, updateStudySessionSchema, {
    maxBytes: STUDY_SESSION_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: await tr("api.invalidLectureId") }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const access = await canAccessLectureContent(user.id, id);

  if (!access.allowed) {
    return createBillingRequiredResponse(
      await tr("api.paidRequired.study"),
      access.code,
    );
  }

  const { error } = await supabase
    .from("lecture_study_sessions")
    .upsert(
      {
        user_id: user.id,
        lecture_id: id,
        active_study_view: parsed.data.activeStudyView,
        flashcard_state: parsed.data.flashcardState,
        quiz_state: parsed.data.quizState,
        practice_test_state: parsed.data.practiceTestState,
      } as never,
      { onConflict: "user_id,lecture_id" },
    );

  if (error) {
    /*
     * The autosave flushes as the workspace unmounts, which is exactly what deleting a note does:
     * `deleteNote` navigates away the moment the DELETE returns. A write already past
     * `ensureUserOwnsLecture` above then lands on a row whose lecture has cascaded away, and
     * `lecture_study_sessions.lecture_id` is `on delete cascade`, so PostgREST answers 23503.
     * The note really is gone, so this is the same 404 the ownership check would have given a
     * moment later — not a server fault. The TTS chunk route settles the same race the same way.
     */
    if (isMissingLectureReferenceError(error)) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    /*
     * Anything else keeps its 500, but must stop being invisible. This autosave fails on a page
     * the learner is usually leaving, so it produces no error-level platform line, and the route
     * used to discard `error` entirely: two production 500s (2026-09-02T16:55:06Z and
     * 2026-09-07T19:17:15Z, different lectures) were each reduced to an empty log record with no
     * SQLSTATE to reason from. The counts and flags below say which part of the payload was in
     * play; the answers themselves are the learner's own writing and never leave the row.
     */
    captureRouteError(error, {
      route: "/api/lectures/[id]/study-session",
      operation: "upsertStudySession",
      request,
      userId: user.id,
      lectureId: id,
      extra: {
        activeStudyView: parsed.data.activeStudyView,
        hasFlashcardState: parsed.data.flashcardState !== null,
        hasQuizState: parsed.data.quizState !== null,
        hasPracticeTestState: parsed.data.practiceTestState !== null,
        textAnswerCount: parsed.data.practiceTestState
          ? Object.keys(parsed.data.practiceTestState.textAnswers).length
          : 0,
      },
    });

    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return updateStudySession(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return updateStudySession(request, context);
}
