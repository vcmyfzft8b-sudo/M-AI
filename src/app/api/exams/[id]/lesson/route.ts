import { NextResponse } from "next/server";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { loadLesson, readOwnedTopic } from "@/lib/exams/exams-server";
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
  });

  if (!params.success || !query.success) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  try {
    const topic = await readOwnedTopic(auth.supabase, auth.user.id, params.data.id, query.data.topicId);

    if (!topic) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    const access = await canUseLectureFeatures(auth.user.id, topic.lecture_id, "study");

    if (!access.allowed) {
      return createBillingRequiredResponse(await tr("api.trialOnly.study"), access.code);
    }

    const load = await loadLesson(auth.supabase, auth.user.id, {
      examId: params.data.id,
      topicId: topic.id,
      kind: query.data.kind,
    });

    if (!load) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    return NextResponse.json(load);
  } catch (error) {
    captureRouteError(error, {
      route: "api:exams:lesson:get",
      operation: "load",
      request,
      userId: auth.user.id,
    });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
