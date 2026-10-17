import { after, NextResponse } from "next/server";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { planPendingTopics, readExamLectureIds, readOwnedExam, warmExamMaterial } from "@/lib/exams/exams-server";
import { examIdParamsSchema } from "@/lib/exams/exam-validation";
import { captureRouteError } from "@/lib/monitoring";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

export const maxDuration = 120;

/**
 * Plans the topics of this exam's notes that have none yet: material that was still being made
 * when the exam was set up. The exam screen calls it while such a note shows as "preparing".
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getRouteUser({ route: "api:exams:topics:post", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:topics:post",
    rules: rateLimitPresets.expensiveMutate,
    userId: auth.user.id,
  });

  if (limited) {
    return limited;
  }

  const params = examIdParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  try {
    const userId = auth.user.id;
    const exam = await readOwnedExam(auth.supabase, userId, params.data.id);

    if (!exam) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    // An archived prep is not studied any more: planning its topics would pay a model for nothing.
    if (exam.archived_at) {
      return NextResponse.json({ error: await tr("api.exam.archived") }, { status: 409 });
    }

    // Planning reads the notes with a model, so it follows the notes' own access, as lessons do.
    const result = await planPendingTopics(auth.supabase, userId, params.data.id, async (lectureId) =>
      (await canUseLectureFeatures(userId, lectureId, "study")).allowed,
    );

    if (result === null) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    if (result.refused) {
      return createBillingRequiredResponse(await tr("api.trialOnly.study"), "trial_exhausted");
    }

    if (result.planned > 0) {
      // A note just planned is ready: its lesson material starts now, in the background.
      after(async () => warmExamMaterial(auth.supabase, userId, await readExamLectureIds(auth.supabase, userId, params.data.id)));
    }

    return NextResponse.json({ planned: result.planned });
  } catch (error) {
    captureRouteError(error, { route: "api:exams:topics:post", operation: "plan", request, userId: auth.user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
