import { NextResponse } from "next/server";
import { z } from "zod";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { markAnswerWithRetry } from "@/lib/practice-test";
import {
  isBlankAnswer,
  isSurrenderAnswer,
  PRACTICE_QUESTION_MAX_SCORE,
} from "@/lib/practice-test-scoring";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSanitizedStringSchema, routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

/**
 * Mark one practice answer, on its own.
 *
 * The memory palace stands a learner outside a house with a single practice
 * question at it, and self-marking against the answer guide is not marking —
 * so this runs the same grader the practice test runs, against the same
 * marking points, and returns the same score out of five with the same
 * feedback. What it does not do is create an attempt: a walk through a town is
 * not a sitting of the test, and it must not turn up in the test's history or
 * move its averages.
 */

const checkSchema = z.object({
  questionId: z.string().uuid(),
  typedAnswer: createSanitizedStringSchema({
    maxLength: 12000,
    multiline: true,
    trim: true,
  }).or(z.literal("")),
  declaredUnknown: z.boolean().optional(),
});

const MAX_CHECK_BYTES = 32 * 1024;

/* One model call, and the same headroom the other marking route allows itself. */
export const maxDuration = 120;

export async function POST(
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
    route: "api:lectures:practice-test:check:post",
    rules: rateLimitPresets.expensiveMutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: await tr("api.invalidLectureId") }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const parsed = await parseJsonRequest(request, checkSchema, { maxBytes: MAX_CHECK_BYTES });

  if (!parsed.success) {
    return parsed.response;
  }

  const lecture = await ensureUserOwnsLecture({ lectureId: id, user });

  if (!lecture) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "practice_test");

  if (!access.allowed) {
    return createBillingRequiredResponse(await tr("api.trialOnly.test"), access.code);
  }

  const { data: question, error: questionError } = await supabase
    .from("practice_test_questions")
    .select("id, prompt, answer_guide")
    .eq("id", parsed.data.questionId)
    .eq("lecture_id", id)
    .maybeSingle();

  if (questionError) {
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }

  const questionRow = question as
    | { id: string; prompt: string; answer_guide: string }
    | null;

  if (!questionRow) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const typedAnswer = parsed.data.typedAnswer.trim();
  /*
   * "I don't know" — ticked, or written into the box, which is the same thing —
   * scores zero without a model call, exactly as a submitted test treats it.
   */
  const surrendered =
    parsed.data.declaredUnknown === true ||
    isBlankAnswer(typedAnswer) ||
    isSurrenderAnswer(typedAnswer);

  if (surrendered) {
    return NextResponse.json({
      marked: true,
      score: 0,
      maxScore: PRACTICE_QUESTION_MAX_SCORE,
      expectedAnswer: questionRow.answer_guide,
      strengths: "",
      missingPoints: "",
    });
  }

  const marked = await markAnswerWithRetry({
    prompt: questionRow.prompt,
    answerGuide: questionRow.answer_guide,
    typedAnswer,
  });

  if (!marked) {
    /* Unmarkable — no marking scheme, or the grader would not answer twice. */
    return NextResponse.json({
      marked: false,
      maxScore: PRACTICE_QUESTION_MAX_SCORE,
      expectedAnswer: questionRow.answer_guide,
    });
  }

  return NextResponse.json({
    marked: true,
    score: marked.score,
    maxScore: PRACTICE_QUESTION_MAX_SCORE,
    expectedAnswer: marked.expectedAnswer,
    strengths: marked.strengths,
    missingPoints: marked.missingPoints,
  });
}
