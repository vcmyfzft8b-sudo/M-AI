import { NextResponse } from "next/server";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadTutorGrounding, planTutorLesson } from "@/lib/tutor-voice";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

export const maxDuration = 300;

/**
 * The running order the walkthrough is taught from.
 *
 * On its own route, and fetched by the client at the same time as the opening
 * turn rather than before it. The plan is around a thousand output tokens and
 * takes several seconds; the greeting needs none of it, so making the learner
 * wait for it was several seconds of silence bought for nothing. By the time
 * the opening has been spoken — the better part of a minute of audio — this has
 * long since arrived.
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

  const grounding = await loadTutorGrounding(id);

  if (!grounding || grounding.notes.trim().length === 0) {
    return NextResponse.json({ error: await tr("api.tutorNotReady") }, { status: 409 });
  }

  try {
    return NextResponse.json({ plan: await planTutorLesson(grounding) });
  } catch (error) {
    console.error("[tutor] plan failed", error);

    return NextResponse.json({ error: await tr("api.tutorStartFailed") }, { status: 502 });
  }
}
