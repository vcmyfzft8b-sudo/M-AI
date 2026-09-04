import { after, NextResponse } from "next/server";

import { createBillingRequiredResponse, hasPaidAccessForUserId } from "@/lib/billing";
import { enqueueLectureMindmapGeneration } from "@/lib/jobs";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { describeMindmapError, queueLectureMindmapGeneration } from "@/lib/mindmap";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

/**
 * Redraws a map that already exists, ignoring the note-hash check the plain POST honours.
 *
 * Paid-only, and a separate route rather than a flag on the other one for that reason: opening
 * the tab is free because it usually costs nothing, and asking for a different map is a model
 * call every time it is pressed.
 */
export const maxDuration = 300;

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

  if (!(await hasPaidAccessForUserId(user.id))) {
    return createBillingRequiredResponse(await tr("api.paidRequired.regenMindmap"));
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:mindmap:regenerate:post",
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

  if (lecture.status !== "ready") {
    return NextResponse.json({ error: await tr("api.mindmapReadyOnly") }, { status: 409 });
  }

  try {
    await queueLectureMindmapGeneration(id);
  } catch (error) {
    return NextResponse.json({ error: describeMindmapError(error) }, { status: 500 });
  }

  after(async () => {
    await enqueueLectureMindmapGeneration(id, true);
  });

  return NextResponse.json({ ok: true });
}
