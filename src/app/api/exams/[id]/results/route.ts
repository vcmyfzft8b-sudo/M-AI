import { NextResponse } from "next/server";

import { examHasModule, recordLessonResult } from "@/lib/exams/exams-server";
import { examIdParamsSchema, lessonResultSchema } from "@/lib/exams/exam-validation";
import { captureRouteError } from "@/lib/monitoring";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

const RESULT_MAX_BYTES = 2 * 1024;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getRouteUser({ route: "api:exams:results:post", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:results:post",
    rules: rateLimitPresets.progress,
    userId: auth.user.id,
  });

  if (limited) {
    return limited;
  }

  const params = examIdParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const parsed = await parseJsonRequest(request, lessonResultSchema, { maxBytes: RESULT_MAX_BYTES });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const inExam = await examHasModule(
      auth.supabase,
      auth.user.id,
      params.data.id,
      parsed.data.lectureId,
    );

    if (!inExam) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    await recordLessonResult(auth.supabase, auth.user.id, {
      examId: params.data.id,
      lectureId: parsed.data.lectureId,
      kind: parsed.data.kind,
      correct: Math.min(parsed.data.correct, parsed.data.total),
      total: parsed.data.total,
      difficulty: parsed.data.difficulty,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    captureRouteError(error, {
      route: "api:exams:results:post",
      operation: "record",
      request,
      userId: auth.user.id,
      lectureId: parsed.data.lectureId,
    });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
