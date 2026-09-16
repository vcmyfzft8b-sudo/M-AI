import { NextResponse } from "next/server";
import { z } from "zod";

import { canSendTrialChatMessage, createBillingRequiredResponse } from "@/lib/billing";
import { getOptionalUserOrPreviewBypass } from "@/lib/auth";
import { createChatEventStream } from "@/lib/chat-stream";
import { getInvocationBudgetMs, runWithinInvocationBudget } from "@/lib/invocation-budget";
import { answerLectureChat } from "@/lib/pipeline";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { chatQuestionSchema, routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

const chatSchema = z.object({
  question: chatQuestionSchema,
  sourceLanguageAction: z.boolean().optional().default(false),
});

export const maxDuration = 300;
const CHAT_REQUEST_MAX_BYTES = 8 * 1024;
/*
 * Never reaches the learner: `createChatEventStream` catches whatever `run` throws, logs it and
 * sends the localised `chat.error.answerFailed` frame instead. This sentence is what a triager
 * reads in the platform log, so it says which budget fired rather than what went wrong.
 */
const CHAT_BUDGET_MESSAGE = "The chat answer outlived its invocation budget.";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const invocationStartedAt = Date.now();
  /*
   * The preview bypass counts as signed in here, so a preview deployment can
   * actually open the chat. Without it every preview answered 401 at the first
   * question, which is not something a reviewer should have to discover.
   */
  const user = await getOptionalUserOrPreviewBypass();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:chat:post",
    rules: rateLimitPresets.expensiveChat,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, chatSchema, {
    maxBytes: CHAT_REQUEST_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
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
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const chatAccess = await canSendTrialChatMessage(user.id, id);

  if (!chatAccess.allowed) {
    return createBillingRequiredResponse(
      chatAccess.code === "trial_chat_limit_reached"
        ? await tr("api.chatLimitReached")
        : await tr("api.trialOnly.chat"),
      chatAccess.code,
    );
  }

  if (lecture.status !== "ready") {
    return NextResponse.json(
      { error: await tr("api.chatNotReady") },
      { status: 409 },
    );
  }

  /*
   * The answer is two model calls deep, not one: a streamed attempt, and — when that attempt
   * fails — the ordinary call the pipeline falls back to (pipeline.ts, `streamChatAnswer`). Each
   * one sizes its own timeout, and outside a budget `getRemainingBudgetMs()` is undefined, so
   * neither knows the other exists: the chat stage has no entry in `STAGE_TIMEOUT_MS`, so both
   * take the 180s OpenRouter default and 360s of attempts are started inside a 300s invocation.
   * The platform then killed the function mid-fallback, which the learner saw as a 504 with no
   * error frame at all.
   *
   * The budget is what makes the clamping in `resolveAiAttemptTimeoutMs` work: the fallback is
   * cut to the time that genuinely remains, and if even that runs out the rejection arrives
   * while the stream is still open to say so.
   */
  return createChatEventStream({
    label: "[chat]",
    errorMessage: await tr("chat.error.answerFailed"),
    run: (send) =>
      runWithinInvocationBudget({
        run: () =>
          answerLectureChat({
            lectureId: id,
            userId: user.id,
            question: parsed.data.question,
            sourceLanguageAction: parsed.data.sourceLanguageAction,
            onDelta: send.delta,
          }),
        budgetMs: getInvocationBudgetMs({
          maxDurationSeconds: maxDuration,
          elapsedMs: Date.now() - invocationStartedAt,
        }),
        deadlineMessage: CHAT_BUDGET_MESSAGE,
      }),
  });
}
