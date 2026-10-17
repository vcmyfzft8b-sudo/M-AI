import { NextResponse } from "next/server";

import { readOwnedExam, recordLessonResult } from "@/lib/exams/exams-server";
import { examIdParamsSchema, lessonResultSchema } from "@/lib/exams/exam-validation";
import { captureRouteError } from "@/lib/monitoring";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

const RESULT_MAX_BYTES = 4 * 1024;

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
    // An archived exam takes no lessons, so it takes no results either (its screen offers to bring it back).
    const exam = await readOwnedExam(auth.supabase, auth.user.id, params.data.id);

    if (!exam) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    if (exam.archived_at) {
      return NextResponse.json({ error: await tr("api.exam.archived") }, { status: 409 });
    }

    const recorded = await recordLessonResult(auth.supabase, auth.user.id, {
      examId: params.data.id,
      topicId: parsed.data.topicId,
      kind: parsed.data.kind,
      correct: Math.min(parsed.data.correct, parsed.data.total),
      total: parsed.data.total,
      difficulty: parsed.data.difficulty,
      itemIds: parsed.data.itemIds,
      missedIds: parsed.data.missedIds,
    });

    if (!recorded) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    captureRouteError(error, {
      route: "api:exams:results:post",
      operation: "record",
      request,
      userId: auth.user.id,
    });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
