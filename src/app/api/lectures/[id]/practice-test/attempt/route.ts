import { NextResponse } from "next/server";

import { sourceLocaleMessage } from "@/lib/lecture-failure-text";
import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import {
  getInvocationBudgetMs,
  InvocationBudgetExceededError,
  runWithinInvocationBudget,
} from "@/lib/invocation-budget";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import {
  createPracticeTestAttempt,
  markStalledPracticeTestGenerationFailed,
} from "@/lib/practice-test";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

// Starting an attempt builds the question bank inline when there is none, or when the stored one
// is stale — a multi-call generation, and the reason this route needs the same 300s every other
// lecture route allows. It was the one route that never declared it.
export const maxDuration = 300;
// Recorded on the stalled generation for triage, in the source language; the reader who pressed
// "start" is answered with `api.testStartTimedOut` in their own.
const ATTEMPT_BUDGET_MESSAGE = sourceLocaleMessage("api.testStartTimedOut");

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const invocationStartedAt = Date.now();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:practice-test:attempt:post",
    rules: rateLimitPresets.expensiveMutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: await tr("api.invalidLectureId") }, { status: 400 });
  }

  const { id } = parsedParams.data;

  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "practice_test");

  if (!access.allowed) {
    return createBillingRequiredResponse(
      await tr("api.trialOnly.test"),
      access.code,
    );
  }

  try {
    const attempt = await runWithinInvocationBudget({
      run: () =>
        createPracticeTestAttempt({
          lectureId: id,
          userId: user.id,
        }),
      budgetMs: getInvocationBudgetMs({
        maxDurationSeconds: maxDuration,
        elapsedMs: Date.now() - invocationStartedAt,
      }),
      deadlineMessage: ATTEMPT_BUDGET_MESSAGE,
    });

    return NextResponse.json(attempt);
  } catch (error) {
    if (error instanceof InvocationBudgetExceededError) {
      // The generation cannot be cancelled and keeps running until the platform kills it seconds
      // from now, taking its own failure handling with it. Record the stall here, while there is
      // still an invocation alive to do it.
      await markStalledPracticeTestGenerationFailed({
        lectureId: id,
        errorMessage: error.message,
      });

      // Not a bad request: the work was accepted and ran out of time. A 504 from the platform was
      // an HTML gateway page the client could only show as a raw fragment.
      // The row keeps the source-language sentence for triage; the reader gets their own.
      return NextResponse.json(
        { error: await tr("api.testStartTimedOut") },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : await tr("api.testStartFailed") },
      { status: 400 },
    );
  }
}
