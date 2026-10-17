import { NextResponse } from "next/server";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { gradeTopicWritten, readOwnedExam, readOwnedTopic } from "@/lib/exams/exams-server";
import { examIdParamsSchema, topicWrittenCheckSchema } from "@/lib/exams/exam-validation";
import { captureRouteError } from "@/lib/monitoring";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

const CHECK_MAX_BYTES = 64 * 1024;

/**
 * Marks a written answer to a question of a topic outside the material (added by the learner or
 * the AI). Questions from the material are marked by the note's own practice-test route.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getRouteUser({ route: "api:exams:written:post", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:written:post",
    rules: rateLimitPresets.expensiveMutate,
    userId: auth.user.id,
  });

  if (limited) {
    return limited;
  }

  const params = examIdParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const parsed = await parseJsonRequest(request, topicWrittenCheckSchema, { maxBytes: CHECK_MAX_BYTES });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const [exam, topic] = await Promise.all([
      readOwnedExam(auth.supabase, auth.user.id, params.data.id),
      readOwnedTopic(auth.supabase, auth.user.id, params.data.id, parsed.data.topicId),
    ]);

    if (!exam || !topic) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    // An archived exam takes no lessons; marking one of its answers would spend a model call for nothing.
    if (exam.archived_at) {
      return NextResponse.json({ error: await tr("api.exam.archived") }, { status: 409 });
    }

    const access = await canUseLectureFeatures(auth.user.id, topic.lecture_id, "study");

    if (!access.allowed) {
      return createBillingRequiredResponse(await tr("api.trialOnly.study"), access.code);
    }

    const mark = await gradeTopicWritten(auth.supabase, auth.user.id, { examId: params.data.id, ...parsed.data });

    if (!mark) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    return NextResponse.json(mark);
  } catch (error) {
    captureRouteError(error, { route: "api:exams:written:post", operation: "grade", request, userId: auth.user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
