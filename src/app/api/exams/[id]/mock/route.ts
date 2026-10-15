import { NextResponse } from "next/server";

import { createBillingRequiredResponse, hasPaidAccessForUserId } from "@/lib/billing";
import { readOwnedExam, startMockExam } from "@/lib/exams/exams-server";
import { examIdParamsSchema, mockStartSchema } from "@/lib/exams/exam-validation";
import { captureRouteError } from "@/lib/monitoring";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

const MOCK_START_MAX_BYTES = 1024;

/** Starts a mock exam ("Generalka"). Paid plans only: grading it is the most expensive call. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getRouteUser({ route: "api:exams:mock:post", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:mock:post",
    rules: rateLimitPresets.expensiveCreate,
    userId: auth.user.id,
  });

  if (limited) {
    return limited;
  }

  const params = examIdParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const parsed = await parseJsonRequest(request, mockStartSchema, { maxBytes: MOCK_START_MAX_BYTES });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const exam = await readOwnedExam(auth.supabase, auth.user.id, params.data.id);

    if (!exam) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    if (!(await hasPaidAccessForUserId(auth.user.id))) {
      return createBillingRequiredResponse(await tr("api.exam.mockPaid"));
    }

    const started = await startMockExam(auth.supabase, auth.user.id, {
      examId: exam.id,
      durationMinutes: parsed.data.durationMinutes,
      mode: parsed.data.mode,
      voice: parsed.data.voice ?? null,
      vibe: parsed.data.vibe ?? null,
    });

    if ("error" in started) {
      return NextResponse.json({ error: await tr("api.exam.noQuestions") }, { status: 422 });
    }

    return NextResponse.json({ attempt: started.attempt }, { status: 201 });
  } catch (error) {
    captureRouteError(error, { route: "api:exams:mock:post", operation: "start", request, userId: auth.user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
