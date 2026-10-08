import { after, NextResponse } from "next/server";

import { createBillingRequiredResponse } from "@/lib/billing";
import { createExamPlanSchema } from "@/lib/exam-prep/schema";
import {
  checkExamLectures,
  createExamPlan,
  isExamPrepUnavailableForUser,
  listExamNoteOptions,
  listExamPlanSummaries,
  prepareExamMaterial,
} from "@/lib/exam-prep/server";
import { tr } from "@/lib/i18n/server";
import { captureRouteError } from "@/lib/monitoring";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { getRouteUser } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";

const CREATE_MAX_BYTES = 8 * 1024;

/**
 * The learner's exams, each with today's progress and its forecast. With
 * `?lectureId=`, only the exams that cover that note, plus the notes an exam
 * could also cover — what a note's Exam tab needs in one request.
 */
export async function GET(request: Request) {
  const auth = await getRouteUser({ route: "GET /api/exams", request });

  if (!auth.user) {
    return auth.response;
  }

  const { user } = auth;
  const limited = await enforceRateLimit({
    request,
    route: "api:exams:get",
    rules: rateLimitPresets.listRead,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const lectureId = new URL(request.url).searchParams.get("lectureId");

  if (lectureId && !uuidSchema.safeParse(lectureId).success) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  try {
    if (lectureId) {
      const [plans, notes] = await Promise.all([
        listExamPlanSummaries(user.id, { lectureId }),
        listExamNoteOptions(user.id),
      ]);

      return NextResponse.json({ plans, notes });
    }

    return NextResponse.json({ plans: await listExamPlanSummaries(user.id) });
  } catch (error) {
    captureRouteError(error, { route: "GET /api/exams", operation: "list", request, userId: user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await getRouteUser({ route: "POST /api/exams", request });

  if (!auth.user) {
    return auth.response;
  }

  const { user } = auth;
  const limited = await enforceRateLimit({
    request,
    route: "api:exams:post",
    rules: rateLimitPresets.create,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  if (isExamPrepUnavailableForUser(user.id)) {
    return NextResponse.json({ error: await tr("api.exam.previewUnavailable") }, { status: 403 });
  }

  const parsed = await parseJsonRequest(request, createExamPlanSchema, {
    maxBytes: CREATE_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const access = await checkExamLectures(user.id, parsed.data.lectureIds);

    if (!access.ok) {
      return access.reason === "billing"
        ? createBillingRequiredResponse(await tr("api.exam.notesLocked"), "trial_exhausted")
        : NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    const id = await createExamPlan(user.id, parsed.data);
    // The plan's notes get their cards and quiz now, not when their tabs are first opened.
    after(() =>
      prepareExamMaterial(user.id, parsed.data.lectureIds).catch((error) =>
        captureRouteError(error, { route: "POST /api/exams", operation: "prepare-material", request, userId: user.id }),
      ),
    );
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    captureRouteError(error, { route: "POST /api/exams", operation: "create", request, userId: user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
