import { after, NextResponse } from "next/server";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { createExam, listExamsForUser, warmExamMaterial } from "@/lib/exams/exams-server";
import { examCreateSchema } from "@/lib/exams/exam-validation";
import { captureRouteError } from "@/lib/monitoring";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

/* The reviewed plan travels with it: a few kilobytes of summary and key points per topic. */
const EXAM_CREATE_MAX_BYTES = 256 * 1024;

export async function GET(request: Request) {
  const auth = await getRouteUser({ route: "api:exams:get", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:get",
    rules: rateLimitPresets.listRead,
    userId: auth.user.id,
  });

  if (limited) {
    return limited;
  }

  try {
    const exams = await listExamsForUser(auth.supabase, auth.user.id);
    return NextResponse.json({ exams });
  } catch (error) {
    captureRouteError(error, { route: "api:exams:get", operation: "list", request, userId: auth.user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await getRouteUser({ route: "api:exams:post", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:post",
    rules: rateLimitPresets.create,
    userId: auth.user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, examCreateSchema, {
    maxBytes: EXAM_CREATE_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    /*
     * An exam studies its notes, so it follows the notes' own access, as planning and lessons do:
     * a note the account cannot study is left out, and an exam with none left is refused.
     */
    const lectureIds: string[] = [];
    let refusal: Awaited<ReturnType<typeof canUseLectureFeatures>> | null = null;

    for (const lectureId of new Set(parsed.data.lectureIds)) {
      const access = await canUseLectureFeatures(auth.user.id, lectureId, "study");

      if (access.allowed) {
        lectureIds.push(lectureId);
      } else {
        refusal = access;
      }
    }

    if (lectureIds.length === 0 && refusal && !refusal.allowed) {
      return createBillingRequiredResponse(await tr("api.trialOnly.study"), refusal.code);
    }

    const created = await createExam(auth.supabase, auth.user.id, { ...parsed.data, lectureIds });
    const userId = auth.user.id;
    // The notes' lesson material, started now rather than when the first lessons ask for it.
    after(() => warmExamMaterial(auth.supabase, userId, lectureIds));

    if ("error" in created) {
      return NextResponse.json({ error: await tr("api.exam.noNotes") }, { status: 422 });
    }

    return NextResponse.json({ exam: created.exam }, { status: 201 });
  } catch (error) {
    captureRouteError(error, { route: "api:exams:post", operation: "create", request, userId: auth.user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
