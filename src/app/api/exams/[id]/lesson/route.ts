import { NextResponse } from "next/server";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { examHasModule, loadLesson } from "@/lib/exams/exams-server";
import { examIdParamsSchema, lessonQuerySchema } from "@/lib/exams/exam-validation";
import { captureRouteError } from "@/lib/monitoring";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

/**
 * One lesson of one module, assembled from the note's existing flashcards, quiz and practice
 * questions. When the note has not had that material generated yet the answer says which
 * generator to start; the client starts it through the note's own route and polls this one.
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
    lectureId: url.searchParams.get("lectureId"),
    kind: url.searchParams.get("kind"),
  });

  if (!params.success || !query.success) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  try {
    const inExam = await examHasModule(
      auth.supabase,
      auth.user.id,
      params.data.id,
      query.data.lectureId,
    );

    if (!inExam) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    const access = await canUseLectureFeatures(auth.user.id, query.data.lectureId, "study");

    if (!access.allowed) {
      return createBillingRequiredResponse(await tr("api.trialOnly.study"), access.code);
    }

    const load = await loadLesson(auth.supabase, auth.user.id, {
      examId: params.data.id,
      lectureId: query.data.lectureId,
      kind: query.data.kind,
    });

    return NextResponse.json(load);
  } catch (error) {
    captureRouteError(error, {
      route: "api:exams:lesson:get",
      operation: "load",
      request,
      userId: auth.user.id,
      lectureId: query.data.lectureId,
    });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
