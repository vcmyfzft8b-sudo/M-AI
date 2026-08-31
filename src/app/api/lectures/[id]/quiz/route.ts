import { after, NextResponse } from "next/server";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { ensureUserOwnsLecture, getLectureDetailForUser } from "@/lib/lectures";
import { enqueueLectureQuizGeneration } from "@/lib/jobs";
import { queueLectureQuizGeneration } from "@/lib/quiz";
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
    route: "api:lectures:quiz:get",
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
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "quiz");

  if (!access.allowed) {
    return createBillingRequiredResponse(
      await tr("api.trialOnly.quiz"),
      access.code,
    );
  }

  return NextResponse.json({
    lectureId: detail.lecture.id,
    status: detail.quizAsset?.status ?? null,
    quizAsset: detail.quizAsset,
    quizQuestions: detail.quizQuestions,
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
    route: "api:lectures:quiz:post",
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
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "quiz");

  if (!access.allowed) {
    return createBillingRequiredResponse(
      await tr("api.trialOnly.quiz"),
      access.code,
    );
  }

  if (lecture.status !== "ready") {
    return NextResponse.json(
      { error: await tr("api.quizReadyOnly") },
      { status: 409 },
    );
  }

  try {
    await queueLectureQuizGeneration(id);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : await tr("api.quizQueueFailed"),
      },
      { status: 500 },
    );
  }

  after(async () => {
    await enqueueLectureQuizGeneration(id);
  });

  return NextResponse.json({ ok: true });
}
