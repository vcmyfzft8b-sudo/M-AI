import { NextResponse } from "next/server";
import { z } from "zod";

import { getViewerAppState } from "@/lib/billing";
import { getOptionalUserOrPreviewBypass } from "@/lib/auth";
import { createChatEventStream } from "@/lib/chat-stream";
import { getInvocationBudgetMs, runWithinInvocationBudget } from "@/lib/invocation-budget";
import { LIBRARY_CHAT_SCOPES, answerLibraryChat } from "@/lib/library-chat";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { tr } from "@/lib/i18n/server";

/**
 * Chat across the learner's whole library — the home ask-bar in the redesign.
 * Answers are not persisted (see `answerLibraryChat`), so this only reads.
 *
 * Which is why `history` is part of the request: the conversation exists only
 * in the open panel, so the client sends back what has been said so far or the
 * tutor answers every question as though it were the first.
 */
const librarySchema = z.object({
  question: z.string().trim().min(1).max(2000),
  sourceLanguageAction: z.boolean().optional().default(false),
  scope: z.enum(LIBRARY_CHAT_SCOPES).default("recent"),
  folderId: z.string().uuid().nullable().default(null),
  useTranscripts: z.boolean().default(true),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .max(40)
    .default([]),
});

export const maxDuration = 300;
/* Room for the transcript the client sends back with each turn. */
const LIBRARY_CHAT_MAX_BYTES = 64 * 1024;

/*
 * Never reaches the learner: `createChatEventStream` turns whatever `run` throws into the
 * localised error frame. This sentence is what a triager reads in the platform log, so it names
 * which budget fired rather than guessing at what went wrong.
 */
const LIBRARY_CHAT_BUDGET_MESSAGE = "The library chat answer outlived its invocation budget.";

export async function POST(request: Request) {
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
    route: "api:library-chat:post",
    rules: rateLimitPresets.expensiveChat,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, librarySchema, {
    maxBytes: LIBRARY_CHAT_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  // Reading across the whole library is a paid capability; the trial chat
  // allowance is scoped to a single note.
  const appState = await getViewerAppState();

  if (!appState?.hasPaidAccess) {
    return NextResponse.json(
      {
        error: await tr("api.libraryChatPaid"),
        code: "billing_required",
      },
      { status: 402 },
    );
  }

  /*
   * The same budget the note chat runs under, and for the same reason: the answer is two model
   * calls deep — a streamed attempt, and the ordinary call it falls back to when that fails —
   * and outside a budget neither knows the other exists. Each would size itself against the
   * stage's own leash inside one 300s invocation, and a platform kill halfway through the
   * fallback closes the connection with no error frame at all. Inside the budget the fallback
   * is clamped to the time that genuinely remains, and if even that is gone the rejection
   * arrives while the stream is still open to carry it.
   */
  return createChatEventStream({
    label: "[library-chat]",
    errorMessage: await tr("libraryChat.error.answerFailed"),
    run: (send) =>
      runWithinInvocationBudget({
        run: () =>
          answerLibraryChat({
            userId: user.id,
            question: parsed.data.question,
            sourceLanguageAction: parsed.data.sourceLanguageAction,
            scope: parsed.data.scope,
            folderId: parsed.data.folderId,
            useTranscripts: parsed.data.useTranscripts,
            history: parsed.data.history,
            onDelta: send.delta,
          }),
        budgetMs: getInvocationBudgetMs({
          maxDurationSeconds: maxDuration,
          elapsedMs: Date.now() - invocationStartedAt,
        }),
        deadlineMessage: LIBRARY_CHAT_BUDGET_MESSAGE,
      }),
  });
}
