import { after, NextResponse } from "next/server";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { enqueueLectureMindmapGeneration } from "@/lib/jobs";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import {
  describeMindmapError,
  loadLectureMindmap,
  queueLectureMindmapGeneration,
} from "@/lib/mindmap";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

/**
 * The map lives behind its own endpoint rather than inside the note's detail payload.
 *
 * That detail read already fans out to a dozen queries on every open of a note, and the map is
 * wanted by exactly one tab that most readers never press. Fetching it when the tab opens costs
 * the reader one request they were going to wait for anyway, and costs everybody else nothing.
 */
export const maxDuration = 300;

export async function GET(
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
    route: "api:lectures:mindmap:get",
    rules: rateLimitPresets.detailRead,
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

  const access = await canUseLectureFeatures(user.id, id, "mindmap");

  if (!access.allowed) {
    return createBillingRequiredResponse(await tr("api.trialOnly.mindmap"), access.code);
  }

  const mindmap = await loadLectureMindmap({ lectureId: id });

  return NextResponse.json({
    lectureId: id,
    lectureStatus: lecture.status,
    ...mindmap,
  });
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
    route: "api:lectures:mindmap:post",
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
  const lecture = await ensureUserOwnsLecture({ lectureId: id, user });

  if (!lecture) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "mindmap");

  if (!access.allowed) {
    return createBillingRequiredResponse(await tr("api.trialOnly.mindmap"), access.code);
  }

  if (lecture.status !== "ready") {
    return NextResponse.json({ error: await tr("api.mindmapReadyOnly") }, { status: 409 });
  }

  try {
    if (!await queueLectureMindmapGeneration(id)) {
      return NextResponse.json({ ok: true });
    }
  } catch (error) {
    return NextResponse.json({ error: describeMindmapError(error) }, { status: 500 });
  }

  after(async () => {
    await enqueueLectureMindmapGeneration(id, false);
  });

  return NextResponse.json({ ok: true });
}
