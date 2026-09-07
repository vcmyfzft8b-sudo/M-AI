import { NextResponse } from "next/server";
import { z } from "zod";

import { tr } from "@/lib/i18n/server";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { captureRouteError } from "@/lib/monitoring";
import { savePodcastProgress } from "@/lib/podcast";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const PROGRESS_REQUEST_MAX_BYTES = 1024;

/*
 * A day in milliseconds. Not a guess about episode length — a sanity bound, so a client with a
 * broken clock or a NaN cannot write a number the library then renders as a four-figure minute
 * count. Real episodes are minutes.
 */
const MAX_POSITION_MS = 24 * 60 * 60 * 1000;

const progressRequestSchema = z.object({
  episodeId: z.string().uuid(),
  positionMs: z.number().int().nonnegative().max(MAX_POSITION_MS),
  /* Absent while the episode is still being synthesized, which is most of a first listen. */
  durationMs: z.number().int().positive().max(MAX_POSITION_MS).nullish(),
  finished: z.boolean().optional(),
});

/**
 * Where the listener got to.
 *
 * Its own route rather than a field on the status GET because of when it is called: on pause, on
 * a throttled tick while playing, and from `sendBeacon` as the tab goes away — a request that has
 * to be small, fire-and-forget, and free of anything the status route does (allowance lookups, a
 * script parse, a segment listing). The answer nobody reads is deliberately empty.
 */
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
    route: "api:lectures:podcast:progress",
    rules: rateLimitPresets.progress,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedBody = await parseJsonRequest(request, progressRequestSchema, {
    maxBytes: PROGRESS_REQUEST_MAX_BYTES,
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

  try {
    await savePodcastProgress({
      lectureId: id,
      podcastId: parsedBody.data.episodeId,
      positionMs: parsedBody.data.positionMs,
      durationMs: parsedBody.data.durationMs ?? null,
      finished: parsedBody.data.finished ?? false,
    });
  } catch (error) {
    captureRouteError(error, {
      route: "api:lectures:podcast:progress",
      operation: "save_progress",
      lectureId: id,
    });

    /*
     * A position that failed to save is not worth telling a listener about — they are listening,
     * and there is nothing for them to do. The client keeps the write in its own buffer and
     * sends it again next time, so the loss is one round trip rather than the position.
     */
    return NextResponse.json({ saved: false }, { status: 200 });
  }

  return NextResponse.json({ saved: true });
}
