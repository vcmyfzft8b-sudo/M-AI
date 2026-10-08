import { NextResponse } from "next/server";
import { z } from "zod";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { recordStudyEvent } from "@/lib/exam-prep/server";
import { tr } from "@/lib/i18n/server";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { getRouteUser } from "@/lib/supabase/server";
import { routeIdParamSchema, uuidSchema } from "@/lib/validation";

const answerSchema = z.object({
  questionId: uuidSchema,
  optionIndex: z.number().int().min(0).max(3),
});

/**
 * Logs one quiz answer to the review log, for the exam journey's memory model
 * and forecast. The quiz itself is marked in the browser and keeps no record
 * of answers, so without this there is no history to judge readiness by.
 *
 * The server does the marking from the stored answer key: the learner's
 * forecast should not rest on what a client says about itself.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getRouteUser({ route: "POST /api/lectures/[id]/quiz/answers", request });

  if (!auth.user) {
    return auth.response;
  }

  const { user, supabase } = auth;
  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:quiz-answers:post",
    rules: rateLimitPresets.progress,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const params = routeIdParamSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const parsed = await parseJsonRequest(request, answerSchema, { maxBytes: 1024 });

  if (!parsed.success) {
    return parsed.response;
  }

  const lectureId = params.data.id;
  const lecture = await ensureUserOwnsLecture({ lectureId, user, supabase });

  if (!lecture) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, lectureId, "quiz");

  if (!access.allowed) {
    return createBillingRequiredResponse(await tr("api.trialOnly.quiz"), access.code);
  }

  const { data: question, error } = await supabase
    .from("quiz_questions")
    .select("id, correct_option_idx")
    .eq("id", parsed.data.questionId)
    .eq("lecture_id", lectureId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }

  const row = question as { id: string; correct_option_idx: number } | null;

  if (!row) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const correct = row.correct_option_idx === parsed.data.optionIndex;
  await recordStudyEvent({
    userId: user.id,
    lectureId,
    kind: "quiz",
    itemId: row.id,
    outcome: correct ? 3 : 1,
  });

  return NextResponse.json({ correct });
}
