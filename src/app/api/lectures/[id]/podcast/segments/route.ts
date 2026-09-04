import { NextResponse } from "next/server";
import { z } from "zod";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { tr } from "@/lib/i18n/server";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { captureRouteError } from "@/lib/monitoring";
import {
  getTtsUsageState,
  hasUnlimitedTtsUsage,
  isTtsProviderRateLimitError,
  TtsGenerationPendingError,
  TtsQuotaLimitError,
} from "@/lib/note-tts";
import { noteTtsVoiceSchema } from "@/lib/note-tts-voice-schema";
import {
  getOrCreatePodcastSegment,
  LectureRemovedDuringPodcastError,
} from "@/lib/podcast";
import { normalizePodcastVoice } from "@/lib/podcast-settings";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";
import type { LecturePodcastRow } from "@/lib/database.types";

export const dynamic = "force-dynamic";
/*
 * One turn is well under a minute of audio and the stream runs at roughly its length, so this is
 * nowhere near the read-aloud chunk route's exposure. It keeps the same ceiling anyway for the
 * same reason that one has it: an invocation the platform kills runs no catch block, and the
 * quota reservation taken at the top would then stay held for ten minutes.
 */
export const maxDuration = 300;

const SEGMENT_REQUEST_MAX_BYTES = 2 * 1024;

const segmentRequestSchema = z.object({
  podcastId: z.string().uuid(),
  segmentIndex: z.number().int().nonnegative(),
  voiceA: noteTtsVoiceSchema,
  voiceB: noteTtsVoiceSchema,
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:podcast:segments",
    rules: rateLimitPresets.podcastSegment,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedBody = await parseJsonRequest(request, segmentRequestSchema, {
    maxBytes: SEGMENT_REQUEST_MAX_BYTES,
  });

  if (!parsedBody.success) {
    return parsedBody.response;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: await tr("api.invalidLectureId") }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({ lectureId: id, user });

  if (!lecture) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "study");

  if (!access.allowed) {
    return createBillingRequiredResponse(await tr("api.paidRequired.tts"), access.code);
  }

  const hasUnlimitedUsage = hasUnlimitedTtsUsage(user.email);
  /*
   * The episode is read back by its id and then checked against this lecture, rather than trusted
   * from the body: the id travels through the client, and ownership of the note is the only thing
   * the route has actually verified.
   */
  const { data: podcastRow, error: podcastError } = await createSupabaseServiceRoleClient()
    .from("lecture_podcasts")
    .select("*")
    .eq("id", parsedBody.data.podcastId)
    .eq("lecture_id", id)
    .maybeSingle();

  if (podcastError) {
    captureRouteError(podcastError, {
      route: "api:lectures:podcast:segments",
      operation: "loadPodcast",
      lectureId: id,
    });

    return NextResponse.json({ error: await tr("podcast.error.audio") }, { status: 500 });
  }

  const podcast = (podcastRow ?? null) as LecturePodcastRow | null;

  if (!podcast || podcast.status !== "ready") {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  try {
    const segment = await getOrCreatePodcastSegment({
      userId: user.id,
      lectureId: id,
      podcast,
      segmentIndex: parsedBody.data.segmentIndex,
      voices: {
        a: normalizePodcastVoice(parsedBody.data.voiceA, "a"),
        b: normalizePodcastVoice(parsedBody.data.voiceB, "b"),
      },
      quotaContext: {
        hasPaidAccess: access.entitlement.hasPaidAccess,
        hasUnlimitedUsage,
      },
    });

    if (!segment) {
      return NextResponse.json({ error: await tr("api.invalidListenPart") }, { status: 400 });
    }

    const quota =
      segment.quota ??
      (await getTtsUsageState({
        userId: user.id,
        hasPaidAccess: access.entitlement.hasPaidAccess,
        hasUnlimitedUsage,
      }));

    return NextResponse.json({
      segmentIndex: segment.row.segment_index,
      speaker: segment.row.speaker,
      audioUrl: segment.audioUrl,
      durationMs: segment.row.duration_ms,
      cues: segment.cues,
      limitSeconds: quota.limitSeconds,
      secondsUsed: quota.secondsUsed,
      remainingSeconds: quota.remainingSeconds,
      hasUnlimitedUsage,
    });
  } catch (error) {
    if (error instanceof TtsQuotaLimitError) {
      return NextResponse.json(
        {
          error: await tr(
            access.entitlement.hasPaidAccess ? "api.ttsDailyLimitPaid" : "api.ttsDailyLimitFree",
          ),
          code: "tts_daily_limit_reached",
          tier: access.entitlement.hasPaidAccess ? "paid" : "free",
          secondsUsed: error.quota.secondsUsed,
          remainingSeconds: error.quota.remainingSeconds,
          limitSeconds: error.quota.limitSeconds,
        },
        { status: 403 },
      );
    }

    /* Being made, or waiting for a stream slot: both mean "ask again shortly", not "this broke". */
    if (error instanceof TtsGenerationPendingError || isTtsProviderRateLimitError(error)) {
      return NextResponse.json(
        { error: await tr("api.audioStillPreparing"), code: "podcast_segment_pending" },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (error instanceof LectureRemovedDuringPodcastError) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    captureRouteError(error, {
      route: "api:lectures:podcast:segments",
      operation: "getOrCreatePodcastSegment",
      lectureId: id,
    });

    return NextResponse.json({ error: await tr("podcast.error.audio") }, { status: 500 });
  }
}
