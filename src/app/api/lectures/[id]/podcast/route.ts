import { NextResponse } from "next/server";
import { z } from "zod";

import { tr } from "@/lib/i18n/server";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { captureRouteError } from "@/lib/monitoring";
import {
  getOrCreatePodcastScript,
  getPodcastRow,
  listPodcastEpisodes,
  listReadyPodcastSegments,
  loadPodcastSource,
  PodcastGenerationPendingError,
  PodcastSourceNotReadyError,
  LectureRemovedDuringPodcastError,
} from "@/lib/podcast";
import { parseStoredTurns } from "@/lib/podcast-script";
import {
  getPodcastFormat,
  podcastCastKey,
  normalizePodcastFormat,
  normalizePodcastLength,
  normalizePodcastVoice,
  PODCAST_FORMAT_IDS,
  PODCAST_LENGTH_IDS,
} from "@/lib/podcast-settings";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getTutorAllowance, toClientUsage } from "@/lib/tutor-usage";
import { parseJsonRequest } from "@/lib/request-validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
/*
 * Writing an episode is one model call that produces a couple of thousand words on a writer that
 * runs at 20-60 tokens a second, with a proven Gemini behind it if that call fails. Both have to
 * fit inside this invocation, which is why the stage's own leash stops well short of it.
 */
export const maxDuration = 300;

const PODCAST_REQUEST_MAX_BYTES = 2 * 1024;

const podcastRequestSchema = z.object({
  format: z.enum(PODCAST_FORMAT_IDS),
  length: z.enum(PODCAST_LENGTH_IDS),
  /* The script's words agree with the hosts' genders, so the cast decides which script this is. */
  voiceA: z.string().trim().min(1).max(32),
  voiceB: z.string().trim().min(1).max(32),
});

/**
 * What the podcast screen knows before anybody presses anything: whether this note can have an
 * episode at all, whether one already exists for the show the listener is looking at, and how
 * much of it has already been synthesized so a returning listener sees it ready rather than
 * watching it be made a second time.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:podcast:status",
    rules: rateLimitPresets.ttsStatus,
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
  const lecture = await ensureUserOwnsLecture({ lectureId: id, user });

  if (!lecture) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  /*
   * No paid gate. The allowance is the gate, exactly as it is for the spoken tutor: a free
   * account can hear a minute of an episode, and what stops anybody is running out of time
   * rather than a plan check in front of the screen.
   */
  const usage = toClientUsage(await getTutorAllowance(user.id));

  const url = new URL(request.url);
  const format = normalizePodcastFormat(url.searchParams.get("format"));
  const length = normalizePodcastLength(url.searchParams.get("length"));
  /*
   * Normalized rather than validated: an unrecognised voice in a query string is a stale bundle
   * or a hand-typed URL, and the honest answer to both is the default voice, not a 400 that
   * leaves the screen with nothing to show.
   */
  const voices = {
    a: normalizePodcastVoice(url.searchParams.get("voiceA"), "a"),
    b: normalizePodcastVoice(url.searchParams.get("voiceB"), "b"),
  };

  const source = await loadPodcastSource(id);

  if (!source) {
    return NextResponse.json({
      available: false,
      reason: "notes_not_ready",
      podcast: null,
      episodes: [],
      usage,
    });
  }

  const [row, episodes] = await Promise.all([
    getPodcastRow({
      lectureId: id,
      contentHash: `${source.contentHash}:${podcastCastKey({
        voices,
        speakerCount: getPodcastFormat(format).speakerCount,
      })}`,
      /* Episodes written before the cast joined the key are still found, and still open. */
      legacyContentHash: source.contentHash,
      format,
      length,
      language: source.language,
    }),
    listPodcastEpisodes({ lectureId: id, contentHash: source.contentHash }),
  ]);

  if (!row) {
    return NextResponse.json({
      available: true,
      reason: null,
      language: source.language,
      podcast: null,
      episodes,
      usage,
    });
  }

  const turns = parseStoredTurns(row.turns);
  const readySegments =
    row.status === "ready" ? await listReadyPodcastSegments({ podcastId: row.id, voices }) : [];

  return NextResponse.json({
    available: true,
    reason: null,
    language: source.language,
    podcast: {
      id: row.id,
      status: row.status,
      title: row.title,
      format,
      length,
      language: row.language,
      turns,
      readySegments,
    },
    episodes,
    usage,
  });
}

/** Writes the episode, or hands back the one that already exists for this note and show. */
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
    route: "api:lectures:podcast:create",
    rules: rateLimitPresets.podcastScript,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedBody = await parseJsonRequest(request, podcastRequestSchema, {
    maxBytes: PODCAST_REQUEST_MAX_BYTES,
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

  /*
   * Writing a script costs a model call rather than seconds of audio, so it is not charged — the
   * same way the tutor's lesson plan is not. But somebody with no listening time left cannot hear
   * what it would write, so they are told before it is written rather than after.
   */
  const allowance = await getTutorAllowance(user.id);

  if (allowance.remainingSeconds <= 0) {
    return NextResponse.json(
      {
        error: await tr(
          allowance.hasPaidAccess ? "api.tutorCreditsNeeded" : "api.tutorTrialUsed",
        ),
        code: allowance.hasPaidAccess ? "tutor_credits_needed" : "tutor_trial_used",
        usage: toClientUsage(allowance),
      },
      { status: 402 },
    );
  }

  try {
    const { row } = await getOrCreatePodcastScript({
      lectureId: id,
      format: parsedBody.data.format,
      length: parsedBody.data.length,
      voices: {
        a: normalizePodcastVoice(parsedBody.data.voiceA, "a"),
        b: normalizePodcastVoice(parsedBody.data.voiceB, "b"),
      },
    });

    return NextResponse.json({
      podcast: {
        id: row.id,
        status: row.status,
        title: row.title,
        format: parsedBody.data.format,
        length: parsedBody.data.length,
        language: row.language,
        turns: parseStoredTurns(row.turns),
        readySegments: [],
      },
      usage: toClientUsage(allowance),
    });
  } catch (error) {
    /*
     * Two of these are answers rather than faults and are logged as such: an episode already
     * being written by another request, and a note with nothing finished to write from. Logging
     * them at error level would put a working generation into the error stream, which is exactly
     * what the read-aloud route had to be corrected for.
     */
    if (error instanceof PodcastGenerationPendingError) {
      return NextResponse.json(
        { error: await tr("podcast.status.writing"), code: "podcast_generation_pending" },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (error instanceof PodcastSourceNotReadyError) {
      return NextResponse.json({ error: await tr("note.notReady") }, { status: 409 });
    }

    if (error instanceof LectureRemovedDuringPodcastError) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    captureRouteError(error, {
      route: "api:lectures:podcast:create",
      operation: "getOrCreatePodcastScript",
      lectureId: id,
    });

    return NextResponse.json({ error: await tr("podcast.error.script") }, { status: 500 });
  }
}
