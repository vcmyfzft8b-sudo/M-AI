import { NextResponse } from "next/server";

import { createBillingRequiredResponse } from "@/lib/billing";
import { updateExamPlanSchema } from "@/lib/exam-prep/schema";
import {
  checkExamLectures,
  deleteExamPlan,
  getExamPlanPayload,
  updateExamPlan,
} from "@/lib/exam-prep/server";
import { tr } from "@/lib/i18n/server";
import { captureRouteError } from "@/lib/monitoring";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { getRouteUser } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

const UPDATE_MAX_BYTES = 8 * 1024;

type RouteContext = { params: Promise<{ id: string }> };

async function resolvePlanId(context: RouteContext) {
  const parsed = routeIdParamSchema.safeParse(await context.params);
  return parsed.success ? parsed.data.id : null;
}

/** The plan with its journey, recomputed from the learner's study right now. */
export async function GET(request: Request, context: RouteContext) {
  const auth = await getRouteUser({ route: "GET /api/exams/[id]", request });

  if (!auth.user) {
    return auth.response;
  }

  const { user } = auth;
  const limited = await enforceRateLimit({
    request,
    route: "api:exams:id:get",
    rules: rateLimitPresets.detailRead,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const planId = await resolvePlanId(context);

  if (!planId) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  try {
    const payload = await getExamPlanPayload(user.id, planId);

    return payload
      ? NextResponse.json(payload)
      : NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  } catch (error) {
    captureRouteError(error, { route: "GET /api/exams/[id]", operation: "detail", request, userId: user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await getRouteUser({ route: "PATCH /api/exams/[id]", request });

  if (!auth.user) {
    return auth.response;
  }

  const { user } = auth;
  const limited = await enforceRateLimit({
    request,
    route: "api:exams:id:patch",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const planId = await resolvePlanId(context);

  if (!planId) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const parsed = await parseJsonRequest(request, updateExamPlanSchema, {
    maxBytes: UPDATE_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    if (parsed.data.lectureIds) {
      const access = await checkExamLectures(user.id, parsed.data.lectureIds);

      if (!access.ok) {
        return access.reason === "billing"
          ? createBillingRequiredResponse(await tr("api.exam.notesLocked"), "trial_exhausted")
          : NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
      }
    }

    const updated = await updateExamPlan(user.id, planId, parsed.data);

    return updated
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  } catch (error) {
    captureRouteError(error, { route: "PATCH /api/exams/[id]", operation: "update", request, userId: user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await getRouteUser({ route: "DELETE /api/exams/[id]", request });

  if (!auth.user) {
    return auth.response;
  }

  const { user } = auth;
  const limited = await enforceRateLimit({
    request,
    route: "api:exams:id:delete",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const planId = await resolvePlanId(context);

  if (!planId) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  try {
    const deleted = await deleteExamPlan(user.id, planId);

    return deleted
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  } catch (error) {
    captureRouteError(error, { route: "DELETE /api/exams/[id]", operation: "delete", request, userId: user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
