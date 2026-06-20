import { NextResponse } from "next/server";
import { z } from "zod";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { ensureUserOwnsLecture, getLectureDetailForUser } from "@/lib/lectures";
import {
  getOrCreateTtsChunk,
  hasUnlimitedTtsUsage,
  hashNoteTtsContent,
  TtsGenerationPendingError,
  TtsQuotaLimitError,
} from "@/lib/note-tts";
import {
  buildNoteTtsChunks,
  parseNoteTtsDocument,
  stripLeadingRedundantHeading,
} from "@/lib/note-tts-text";
import { DEFAULT_NOTE_TTS_VOICE, NOTE_TTS_VOICES } from "@/lib/note-tts-settings";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TTS_CHUNK_REQUEST_MAX_BYTES = 4 * 1024;
const TTS_PROVIDER_RETRY_DELAYS_MS = [1_500, 3_500];

const ttsChunkRequestSchema = z.object({
  sessionId: z.string().trim().min(8).max(128),
  chunkIndex: z.number().int().nonnegative(),
  voice: z.enum(NOTE_TTS_VOICES).default(DEFAULT_NOTE_TTS_VOICE),
});

function createTtsLimitResponse(params: {
  secondsUsed: number;
  remainingSeconds: number;
  limitSeconds: number;
}) {
  return NextResponse.json(
    {
      error: "Porabil si današnje ustvarjanje zvoka.",
      code: "tts_daily_limit_reached",
      secondsUsed: params.secondsUsed,
      remainingSeconds: params.remainingSeconds,
      limitSeconds: params.limitSeconds,
    },
    { status: 429 },
  );
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isProviderRateLimitError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const statusCode =
    "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : undefined;
  const message = error instanceof Error ? error.message : "";

  return statusCode === 429 || message.includes("HTTP 429") || message.includes("rate limit");
}

async function retryProviderRateLimit<T>(operation: () => Promise<T>) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= TTS_PROVIDER_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isProviderRateLimitError(error) || attempt >= TTS_PROVIDER_RETRY_DELAYS_MS.length) {
        throw error;
      }

      await wait(TTS_PROVIDER_RETRY_DELAYS_MS[attempt] ?? 0);
    }
  }

  throw lastError;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:tts:chunks",
    rules: rateLimitPresets.ttsChunk,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedBody = await parseJsonRequest(request, ttsChunkRequestSchema, {
    maxBytes: TTS_CHUNK_REQUEST_MAX_BYTES,
  });

  if (!parsedBody.success) {
    return parsedBody.response;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Neveljaven ID zapiska." }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "study");
  const hasUnlimitedUsage = hasUnlimitedTtsUsage(user.email);

  if (!access.allowed) {
    return createBillingRequiredResponse(
      "Pred ustvarjanjem zvoka za ta zapisek izberi paket.",
      access.code,
    );
  }

  const detail = await getLectureDetailForUser({
    lectureId: id,
    userId: user.id,
  });

  if (!detail) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const content = detail.artifact?.structured_notes_md
    ? stripLeadingRedundantHeading(detail.artifact.structured_notes_md, detail.lecture.title)
    : "";

  if (detail.lecture.status !== "ready" || !content) {
    return NextResponse.json({ error: "Zapiski še niso pripravljeni." }, { status: 409 });
  }

  const document = parseNoteTtsDocument(content);
  const chunks = buildNoteTtsChunks(document);
  const chunk = chunks[parsedBody.data.chunkIndex];

  if (!chunk) {
    return NextResponse.json({ error: "Neveljaven del poslušanja." }, { status: 400 });
  }

  const contentHash = hashNoteTtsContent(content);
  let generated: Awaited<ReturnType<typeof getOrCreateTtsChunk>>;

  try {
    generated = await retryProviderRateLimit(() =>
      getOrCreateTtsChunk({
        userId: user.id,
        lectureId: id,
        contentHash,
        chunk,
        allWords: document.words,
        languageHint: detail.lecture.language_hint,
        voice: parsedBody.data.voice,
        quotaContext: {
          hasPaidAccess: access.entitlement.hasPaidAccess,
          hasUnlimitedUsage,
        },
      }),
    );
  } catch (error) {
    console.error("Failed to prepare note TTS chunk", error);

    if (error instanceof TtsQuotaLimitError) {
      return createTtsLimitResponse(error.quota);
    }

    if (error instanceof TtsGenerationPendingError) {
      return NextResponse.json(
        {
          error: "Zvok se še pripravlja. Poskusi znova čez trenutek.",
          code: "tts_generation_pending",
        },
        { status: 503 },
      );
    }

    if (isProviderRateLimitError(error)) {
      return NextResponse.json(
        {
          error: "Zvok se še pripravlja. Poskusi znova čez trenutek.",
          code: "tts_provider_rate_limited",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "production" || isProviderRateLimitError(error)
            ? "Zvoka ni bilo mogoče pripraviti."
            : error instanceof Error
              ? error.message
              : "Zvoka ni bilo mogoče pripraviti.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    audioUrl: generated.audioUrl,
    chunkIndex: chunk.chunkIndex,
    chunkCount: chunks.length,
    wordStartIndex: generated.row.word_start_index,
    wordEndIndex: generated.row.word_end_index,
    durationMs: generated.row.duration_ms,
    alignment: generated.alignment,
    limitSeconds: generated.quota.limitSeconds,
    secondsUsed: generated.quota.secondsUsed,
    remainingSeconds: generated.quota.remainingSeconds,
    hasUnlimitedUsage,
  });
}
