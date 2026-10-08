import { NextResponse } from "next/server";

import { examTaskCheckSchema } from "@/lib/exam-prep/schema";
import { setExamTaskCheck } from "@/lib/exam-prep/server";
import { tr } from "@/lib/i18n/server";
import { captureRouteError } from "@/lib/monitoring";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { getRouteUser } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

/**
 * Ticks (or unticks) a task the app cannot see being done: explaining a topic
 * aloud, the night-before wind-down, reading a note that has no cards.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getRouteUser({ route: "POST /api/exams/[id]/checks", request });

  if (!auth.user) {
    return auth.response;
  }

  const { user } = auth;
  const limited = await enforceRateLimit({
    request,
    route: "api:exams:checks:post",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const params = routeIdParamSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const parsed = await parseJsonRequest(request, examTaskCheckSchema, { maxBytes: 2 * 1024 });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const saved = await setExamTaskCheck(user.id, params.data.id, parsed.data);

    return saved
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  } catch (error) {
    captureRouteError(error, { route: "POST /api/exams/[id]/checks", operation: "check", request, userId: user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
