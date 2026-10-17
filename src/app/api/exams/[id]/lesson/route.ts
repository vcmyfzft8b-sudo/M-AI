import { NextResponse } from "next/server";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { ExamModelCallRefused, loadLesson, readOwnedExam, readOwnedTopic, tutorTimeLeft } from "@/lib/exams/exams-server";
import { examIdParamsSchema, lessonQuerySchema } from "@/lib/exams/exam-validation";
import { captureRouteError } from "@/lib/monitoring";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

/* Sorting a note's items into topics, or writing a topic's lessons, is a model call. */
export const maxDuration = 120;

/**
 * One lesson of one topic: from the note's own flashcards, quiz and practice questions sorted into
 * the topic, or the lessons written for a topic outside the material. When the note has not had
 * that material generated yet the answer says which generator to start; the client starts it
 * through the note's own route and polls this one.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getRouteUser({ route: "api:exams:lesson:get", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:lesson:get",
    rules: rateLimitPresets.detailRead,
    userId: auth.user.id,
  });

  if (limited) {
    return limited;
  }

  const params = examIdParamsSchema.safeParse(await context.params);
  const url = new URL(request.url);
  const query = lessonQuerySchema.safeParse({
    topicId: url.searchParams.get("topicId"),
    kind: url.searchParams.get("kind"),
    check: url.searchParams.get("check") === "1",
  });

  if (!params.success || !query.success) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const userId = auth.user.id;
  /*
   * Most loads only read, and the client polls this route while a note's material is being made,
   * so the route itself has the read limit. A load that has to call the model (the tutor's plan,
   * sorting a note's items into topics, writing a topic's lessons or fresh questions) is also
   * held to the expensive limit, asked once per request just before the first call.
   */
  const model: { limited: Promise<Response | null> | null } = { limited: null };
  const mayCallModel = async () => {
    model.limited ??= enforceRateLimit({
      request,
      route: "api:exams:lesson:generate",
      rules: rateLimitPresets.expensiveMutate,
      userId,
    });

    return (await model.limited) === null;
  };

  try {
    const [exam, topic] = await Promise.all([
      readOwnedExam(auth.supabase, userId, params.data.id),
      readOwnedTopic(auth.supabase, userId, params.data.id, query.data.topicId),
    ]);

    if (!exam || !topic) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    if (exam.archived_at) {
      return NextResponse.json({ error: await tr("api.exam.archived") }, { status: 409 });
    }

    const access = await canUseLectureFeatures(userId, topic.lecture_id, "study");

    if (!access.allowed) {
      return createBillingRequiredResponse(await tr("api.trialOnly.study"), access.code);
    }

    // No talking time left: the tutor's plan (a model call) is not made for a lesson that cannot speak.
    if (query.data.kind === "tutor" && !(await tutorTimeLeft(userId))) {
      return NextResponse.json({ error: await tr("api.exam.tutorTime"), code: "tutor_time" }, { status: 409 });
    }

    const load = await loadLesson(auth.supabase, userId, {
      examId: params.data.id,
      topicId: topic.id,
      kind: query.data.kind,
      check: query.data.check,
      mayCallModel,
    });

    if (!load) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    return NextResponse.json(load);
  } catch (error) {
    const limitedResponse = error instanceof ExamModelCallRefused ? await model.limited : null;

    if (limitedResponse) {
      return limitedResponse;
    }

    captureRouteError(error, {
      route: "api:exams:lesson:get",
      operation: "load",
      request,
      userId: auth.user.id,
    });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
