import { NextResponse } from "next/server";
import { z } from "zod";

import { getViewerAppState } from "@/lib/billing";
import { LIBRARY_CHAT_SCOPES, answerLibraryChat } from "@/lib/library-chat";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Chat across the learner's whole library — the home ask-bar in the redesign.
 * Answers are not persisted (see `answerLibraryChat`), so this only reads.
 */
const librarySchema = z.object({
  question: z.string().trim().min(1).max(2000),
  scope: z.enum(LIBRARY_CHAT_SCOPES).default("recent"),
  folderId: z.string().uuid().nullable().default(null),
  useTranscripts: z.boolean().default(true),
});

export const maxDuration = 300;
const LIBRARY_CHAT_MAX_BYTES = 8 * 1024;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
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
        error: "Klepet z vsemi zapiski je na voljo z naročnino.",
        code: "billing_required",
      },
      { status: 402 },
    );
  }

  try {
    const result = await answerLibraryChat({
      userId: user.id,
      question: parsed.data.question,
      scope: parsed.data.scope,
      folderId: parsed.data.folderId,
      useTranscripts: parsed.data.useTranscripts,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[library-chat] failed", error);
    return NextResponse.json(
      { error: "Odgovora ni bilo mogoče pripraviti. Poskusi znova." },
      { status: 500 },
    );
  }
}
