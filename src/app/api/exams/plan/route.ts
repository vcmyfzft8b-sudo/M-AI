import { NextResponse } from "next/server";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { planExamTopics } from "@/lib/exams/exams-server";
import { examPlanSchema } from "@/lib/exams/exam-validation";
import { captureRouteError } from "@/lib/monitoring";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

/* One model call per note, up to four at once, plus one for AI-added topics. */
export const maxDuration = 120;

const PLAN_MAX_BYTES = 8 * 1024;

/**
 * The setup's "Creating your study path": splits the chosen notes into topics for the learner to
 * review. Stores nothing; creating the exam stores the plan as the learner leaves it.
 */
export async function POST(request: Request) {
  const auth = await getRouteUser({ route: "api:exams:plan:post", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:plan:post",
    rules: rateLimitPresets.expensiveMutate,
    userId: auth.user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, examPlanSchema, { maxBytes: PLAN_MAX_BYTES });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    // Planning reads the notes with a model, so it follows the notes' own access, as lessons do.
    for (const lectureId of new Set(parsed.data.lectureIds)) {
      const access = await canUseLectureFeatures(auth.user.id, lectureId, "study");

      if (!access.allowed) {
        return createBillingRequiredResponse(await tr("api.trialOnly.study"), access.code);
      }
    }

    const notes = await planExamTopics(auth.supabase, auth.user.id, parsed.data);
    return NextResponse.json({ notes });
  } catch (error) {
    captureRouteError(error, { route: "api:exams:plan:post", operation: "plan", request, userId: auth.user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
