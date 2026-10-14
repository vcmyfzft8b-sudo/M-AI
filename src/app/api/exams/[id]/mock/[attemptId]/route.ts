import { NextResponse } from "next/server";

import { createBillingRequiredResponse, hasPaidAccessForUserId } from "@/lib/billing";
import {
  mockResultFromAttempt,
  readMockAttempt,
  readOwnedExam,
  submitMockExam,
} from "@/lib/exams/exams-server";
import { mockParamsSchema, mockSubmitSchema } from "@/lib/exams/exam-validation";
import { captureRouteError } from "@/lib/monitoring";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

const MOCK_SUBMIT_MAX_BYTES = 256 * 1024;

/* Up to six written answers marked in parallel, each with one retry. */
export const maxDuration = 300;

/** Hands in a mock exam and grades it. A graded attempt is returned as it stands. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; attemptId: string }> },
) {
  const auth = await getRouteUser({ route: "api:exams:mock:submit", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:mock:submit",
    rules: rateLimitPresets.expensiveMutate,
    userId: auth.user.id,
  });

  if (limited) {
    return limited;
  }

  const params = mockParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const parsed = await parseJsonRequest(request, mockSubmitSchema, { maxBytes: MOCK_SUBMIT_MAX_BYTES });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const [exam, attempt] = await Promise.all([
      readOwnedExam(auth.supabase, auth.user.id, params.data.id),
      readMockAttempt(auth.supabase, auth.user.id, params.data.id, params.data.attemptId),
    ]);

    if (!exam || !attempt) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    if (attempt.status === "graded") {
      return NextResponse.json({ result: mockResultFromAttempt(exam, attempt) });
    }

    if (!(await hasPaidAccessForUserId(auth.user.id))) {
      return createBillingRequiredResponse(await tr("api.exam.mockPaid"));
    }

    const result = await submitMockExam(auth.supabase, auth.user.id, {
      exam,
      attempt,
      answers: parsed.data.answers,
    });

    if (!result) {
      return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 409 });
    }

    return NextResponse.json({ result });
  } catch (error) {
    captureRouteError(error, { route: "api:exams:mock:submit", operation: "grade", request, userId: auth.user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
