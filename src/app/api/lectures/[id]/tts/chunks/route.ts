import { NextResponse } from "next/server";
import { z } from "zod";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { ensureUserOwnsLecture, getLectureDetailForUser } from "@/lib/lectures";
import {
  getOrCreateTtsChunk,
  getTtsUsageState,
  hasUnlimitedTtsUsage,
  hashNoteTtsContent,
  LectureRemovedDuringTtsError,
  TtsGenerationPendingError,
  TtsQuotaLimitError,
} from "@/lib/note-tts";
import {
  buildNoteTtsChunks,
  parseNoteTtsDocument,
  stripLeadingRedundantHeading,
} from "@/lib/note-tts-text";
import { DEFAULT_NOTE_TTS_VOICE } from "@/lib/note-tts-settings";
import { noteTtsVoiceSchema } from "@/lib/note-tts-voice-schema";
import {
  TTS_CHUNK_LEGACY_PENDING_STATUS,
  TTS_CHUNK_PENDING_STATUS,
} from "@/lib/note-tts-retry";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
// Generating a chunk means synthesizing the audio, aligning it, uploading it and recording the
// row — measured at 90-119s in production when chunks were two minutes long. At the 120s this route
// used to allow, that ran right up against the ceiling, and an invocation Vercel kills runs no
// catch block: the quota reservation taken at the start was never released, so it stayed held for
// TTS_GENERATION_RESERVATION_STALE_MS and every request for that chunk over the following ten
// minutes waited on a generation that was already dead and then 503'd. Every other route doing
// comparable work already allows 300s; this one was the outlier, and the only one being killed.
export const maxDuration = 300;

const TTS_CHUNK_REQUEST_MAX_BYTES = 4 * 1024;
const TTS_PROVIDER_RETRY_DELAYS_MS = [1_500, 3_500];

const ttsChunkRequestSchema = z.object({
  sessionId: z.string().trim().min(8).max(128),
  chunkIndex: z.number().int().nonnegative(),
  voice: noteTtsVoiceSchema.default(DEFAULT_NOTE_TTS_VOICE),
  // Set by clients that understand a 202 "still generating" answer. Absent from bundles that
  // predate it, which still need the 503 — see TTS_CHUNK_PENDING_STATUS.
  acceptsPendingStatus: z.boolean().default(false),
});

async function createTtsLimitResponse(params: {
  secondsUsed: number;
  remainingSeconds: number;
  limitSeconds: number;
  hasPaidAccess: boolean;
}) {
  // A paid account has simply run out for the day; a free one is being told it
  // could buy its way past the limit. Two different sentences, not one with a
  // clause bolted on.
  const error = await tr(
    params.hasPaidAccess ? "api.ttsDailyLimitPaid" : "api.ttsDailyLimitFree",
  );

  return NextResponse.json(
    {
      error,
      code: "tts_daily_limit_reached",
      tier: params.hasPaidAccess ? "paid" : "free",
      secondsUsed: params.secondsUsed,
      remainingSeconds: params.remainingSeconds,
      limitSeconds: params.limitSeconds,
    },
    { status: 403 },
  );
}

async function createTtsLimitResponseIfQuotaCannotCreateChunk(params: {
  userId: string;
  hasPaidAccess: boolean;
  hasUnlimitedUsage: boolean;
  estimatedSeconds: number;
}) {
  const usage = await getTtsUsageState({
    userId: params.userId,
    hasPaidAccess: params.hasPaidAccess,
    hasUnlimitedUsage: params.hasUnlimitedUsage,
  });

  if (usage.hasUnlimitedUsage) {
    return null;
  }

  const requiredSeconds = Math.max(1, Math.ceil(params.estimatedSeconds));

  if (usage.remainingSeconds >= requiredSeconds) {
    return null;
  }

  return await createTtsLimitResponse({
    secondsUsed: usage.secondsUsed,
    remainingSeconds: usage.remainingSeconds,
    limitSeconds: usage.limitSeconds,
    hasPaidAccess: params.hasPaidAccess,
  });
}

// The audio is on its way; the caller should ask again shortly. That is an accepted request, not a
// failed one, so it answers 202 — a 503 here counted against the production error rate and made a
// working generation look like an outage. Clients that predate the 202 still get the 503.
async function createPendingResponse(
  code: "tts_generation_pending" | "tts_provider_rate_limited",
  acceptsPendingStatus: boolean,
) {
  return NextResponse.json(
    {
      error: await tr("api.audioStillPreparing"),
      code,
    },
    {
      status: acceptsPendingStatus
        ? TTS_CHUNK_PENDING_STATUS
        : TTS_CHUNK_LEGACY_PENDING_STATUS,
      headers: { "Cache-Control": "no-store" },
    },
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
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:tts:chunks:v2",
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

  const access = await canUseLectureFeatures(user.id, id, "study");
  const hasUnlimitedUsage = hasUnlimitedTtsUsage(user.email);

  if (!access.allowed) {
    return createBillingRequiredResponse(
      await tr("api.paidRequired.tts"),
      access.code,
    );
  }

  const detail = await getLectureDetailForUser({
    lectureId: id,
    userId: user.id,
    verifiedLecture: lecture,
  });

  if (!detail) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const content = detail.artifact?.structured_notes_md
    ? stripLeadingRedundantHeading(detail.artifact.structured_notes_md, detail.lecture.title)
    : "";

  if (detail.lecture.status !== "ready" || !content) {
    return NextResponse.json({ error: await tr("note.notReady") }, { status: 409 });
  }

  const document = parseNoteTtsDocument(content);
  const chunks = buildNoteTtsChunks(document);
  const chunk = chunks[parsedBody.data.chunkIndex];

  if (!chunk) {
    return NextResponse.json({ error: await tr("api.invalidListenPart") }, { status: 400 });
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
        sourceText: detail.artifact?.structured_notes_md ?? "",
        sourceMetadata: detail.artifact?.model_metadata,
        voice: parsedBody.data.voice,
        quotaContext: {
          hasPaidAccess: access.entitlement.hasPaidAccess,
          hasUnlimitedUsage,
        },
      }),
    );
  } catch (error) {
    // A spent daily allowance and a generation that is still running are answers, not faults: the
    // route reports them as 403/503 and the client acts on them. Logging them at error level with
    // a stack put hundreds of entries a day into the error stream and buried the failures that do
    // need looking at — the 500 below stays logged.

    if (error instanceof TtsQuotaLimitError) {
      return await createTtsLimitResponse({
        ...error.quota,
        hasPaidAccess: access.entitlement.hasPaidAccess,
      });
    }

    if (error instanceof TtsGenerationPendingError) {
      const quotaLimitResponse = await createTtsLimitResponseIfQuotaCannotCreateChunk({
        userId: user.id,
        hasPaidAccess: access.entitlement.hasPaidAccess,
        hasUnlimitedUsage,
        estimatedSeconds: chunk.estimatedSeconds,
      });

      if (quotaLimitResponse) {
        return quotaLimitResponse;
      }

      return await createPendingResponse(
        "tts_generation_pending",
        parsedBody.data.acceptsPendingStatus,
      );
    }

    // The note existed when this request checked it, two minutes ago, and the reader deleted it
    // while the audio was being synthesized. The same answer the route gives when it is gone from
    // the start — a 500 said the server had broken, and put a stack in the error stream for a
    // deletion that worked exactly as intended.
    if (error instanceof LectureRemovedDuringTtsError) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    if (isProviderRateLimitError(error)) {
      const quotaLimitResponse = await createTtsLimitResponseIfQuotaCannotCreateChunk({
        userId: user.id,
        hasPaidAccess: access.entitlement.hasPaidAccess,
        hasUnlimitedUsage,
        estimatedSeconds: chunk.estimatedSeconds,
      });

      if (quotaLimitResponse) {
        return quotaLimitResponse;
      }

      return await createPendingResponse(
        "tts_provider_rate_limited",
        parsedBody.data.acceptsPendingStatus,
      );
    }

    console.error("Failed to prepare note TTS chunk", error);

    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "production" || isProviderRateLimitError(error)
            ? await tr("api.audioPrepareFailed")
            : error instanceof Error
              ? error.message
              : await tr("api.audioPrepareFailed"),
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
