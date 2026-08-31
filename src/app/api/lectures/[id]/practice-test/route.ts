import { after, NextResponse } from "next/server";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { ensureUserOwnsLecture, getLectureDetailForUser } from "@/lib/lectures";
import { enqueueLecturePracticeTestGeneration } from "@/lib/jobs";
import {
  describePracticeTestError,
  queueLecturePracticeTestGeneration,
} from "@/lib/practice-test";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

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
    route: "api:lectures:practice-test:get",
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

  const detail = await getLectureDetailForUser({
    lectureId: id,
    userId: user.id,
  });

  if (!detail) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "practice_test");

  if (!access.allowed) {
    return createBillingRequiredResponse(
      await tr("api.trialOnly.test"),
      access.code,
    );
  }

  return NextResponse.json({
    lectureId: detail.lecture.id,
    status: detail.practiceTestAsset?.status ?? null,
    practiceTestAsset: detail.practiceTestAsset,
    practiceTestQuestions: detail.practiceTestQuestions,
    practiceTestAttempts: detail.practiceTestAttempts,
    practiceTestHistorySummary: detail.practiceTestHistorySummary,
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
    route: "api:lectures:practice-test:post",
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

  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "practice_test");

  if (!access.allowed) {
    return createBillingRequiredResponse(
      await tr("api.trialOnly.test"),
      access.code,
    );
  }

  if (lecture.status !== "ready") {
    return NextResponse.json(
      { error: await tr("api.testReadyOnly") },
      { status: 409 },
    );
  }

  try {
    await queueLecturePracticeTestGeneration(id);
  } catch (error) {
    return NextResponse.json(
      {
        error: describePracticeTestError(error),
      },
      { status: 500 },
    );
  }

  after(async () => {
    await enqueueLecturePracticeTestGeneration(id);
  });

  return NextResponse.json({ ok: true });
}
