import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getInvocationBudgetMs,
  InvocationBudgetExceededError,
  runWithinInvocationBudget,
} from "@/lib/invocation-budget";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { sourceLocaleMessage } from "@/lib/lecture-failure-text";
import {
  describePracticeTestError,
  markStalledPracticeTestAttemptFailed,
  submitPracticeTestAttempt,
} from "@/lib/practice-test";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSanitizedStringSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

const paramsSchema = z.object({
  id: z.string().uuid(),
  attemptId: z.string().uuid(),
});

const submitSchema = z.object({
  answers: z
    .array(
      z.object({
        answerId: z.string().uuid(),
        typedAnswer: createSanitizedStringSchema({
          maxLength: 12000,
          multiline: true,
          trim: true,
        }).or(z.literal("")),
        declaredUnknown: z.boolean(),
      }),
    )
    .min(1)
    .max(20),
});

const MAX_SUBMIT_BYTES = 256 * 1024;

// Grading a submitted test is one model call per question, in waves — the same order of work the
// other practice-test routes allow themselves 300 seconds for. This was the one that never
// declared it, and inherited the platform default instead.
export const maxDuration = 300;
// Recorded on the stalled attempt for triage, in the source language; the reader who pressed
// "submit" is answered with `api.testSubmitTimedOut` in their own.
const SUBMIT_BUDGET_MESSAGE = sourceLocaleMessage("api.testSubmitTimedOut");

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; attemptId: string }> },
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
    route: "api:lectures:practice-test:submit:post",
    rules: rateLimitPresets.expensiveMutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: await tr("api.invalidParams") }, { status: 400 });
  }

  const parsed = await parseJsonRequest(request, submitSchema, {
    maxBytes: MAX_SUBMIT_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const lecture = await ensureUserOwnsLecture({
    lectureId: parsedParams.data.id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  try {
    const result = await runWithinInvocationBudget({
      run: () =>
        submitPracticeTestAttempt({
          lectureId: parsedParams.data.id,
          userId: user.id,
          attemptId: parsedParams.data.attemptId,
          answers: parsed.data.answers,
        }),
      budgetMs: getInvocationBudgetMs({
        maxDurationSeconds: maxDuration,
        elapsedMs: Date.now() - invocationStartedAt,
      }),
      deadlineMessage: SUBMIT_BUDGET_MESSAGE,
    });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    if (error instanceof InvocationBudgetExceededError) {
      // The grading calls cannot be cancelled and keep running until the platform kills them
      // seconds from now, taking their own failure handling with them.
      await markStalledPracticeTestAttemptFailed({
        attemptId: parsedParams.data.attemptId,
        errorMessage: error.message,
      });

      // Not a bad request: the answers were accepted and the marking ran out of time.
      return NextResponse.json(
        { error: await tr("api.testSubmitTimedOut") },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: describePracticeTestError(error) },
      { status: 400 },
    );
  }
}
