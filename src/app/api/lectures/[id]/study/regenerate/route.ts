import { after, NextResponse } from "next/server";

import { createBillingRequiredResponse, hasPaidAccessForUserId } from "@/lib/billing";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { enqueueLectureStudyGeneration } from "@/lib/jobs";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

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
    return createBillingRequiredResponse(await tr("api.paidRequired.regenCards"));
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:study-regenerate:post",
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

  if (lecture.status !== "ready") {
    return NextResponse.json(
      { error: await tr("api.studyRegenReadyOnly") },
      { status: 409 },
    );
  }

  const service = createSupabaseServiceRoleClient();
  const { error } = await service
    .from("lecture_study_assets")
    .upsert(
      {
        lecture_id: id,
        status: "queued",
        error_message: null,
        model_metadata: {},
      } as never,
      {
        onConflict: "lecture_id",
      },
    );

  if (error) {
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }

  after(async () => {
    await enqueueLectureStudyGeneration(id);
  });

  return NextResponse.json({ ok: true });
}
