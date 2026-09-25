import { NextResponse } from "next/server";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { ensureTutorPlan } from "@/lib/tutor-plan";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

export const maxDuration = 300;

/**
 * The running order the walkthrough is taught from.
 *
 * On its own route, and fetched by the client at the same time as the opening turn rather than
 * before it, because the greeting needs none of it.
 *
 * Since 2026-09-04 it is normally not generated here at all. The pipeline works it out when the
 * note is written, so this reads it back in milliseconds. That was worth doing because the plan
 * is the one part of the tutor that cannot be made fast — 19 to 51 seconds on the model that
 * covers the material properly — and generated at session start it only just fits behind the
 * greeting: a measured 40-second run landed six seconds before the speech ended, and the slow
 * tail did not fit at all.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getRouteUser({ route: "POST /api/lectures/[id]/tutor/plan", request });

  if (!auth.user) {
    return auth.response;
  }

  const { user } = auth;

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:tutor:plan",
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

  const access = await canUseLectureFeatures(user.id, id, "chat");

  if (!access.allowed) {
    return createBillingRequiredResponse(await tr("api.trialOnly.tutor"), access.code);
  }

  try {
    /*
     * Normally already worked out: the pipeline warms this when the note is written, so this
     * answers from storage in milliseconds. A miss — a lecture written before the warm-up
     * existed, one whose warm-up failed, or a note edited since — generates on the spot, which
     * is exactly what every session used to do.
     */
    const plan = await ensureTutorPlan(id);

    if (!plan) {
      return NextResponse.json({ error: await tr("api.tutorNotReady") }, { status: 409 });
    }

    return NextResponse.json({ plan });
  } catch (error) {
    console.error("[tutor] plan failed", error);

    return NextResponse.json({ error: await tr("api.tutorStartFailed") }, { status: 502 });
  }
}
