import { NextResponse } from "next/server";

import { deleteExam, getExamDetail, updateExam } from "@/lib/exams/exams-server";
import { examIdParamsSchema, examPatchSchema } from "@/lib/exams/exam-validation";
import { captureRouteError } from "@/lib/monitoring";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

const EXAM_PATCH_MAX_BYTES = 4 * 1024;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const auth = await getRouteUser({ route: "api:exams:id:get", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:id:get",
    rules: rateLimitPresets.detailRead,
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
    const detail = await getExamDetail(auth.supabase, auth.user.id, params.data.id);

    if (!detail) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    return NextResponse.json({ detail });
  } catch (error) {
    captureRouteError(error, { route: "api:exams:id:get", operation: "detail", request, userId: auth.user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await getRouteUser({ route: "api:exams:id:patch", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:id:patch",
    rules: rateLimitPresets.mutate,
    userId: auth.user.id,
  });

  if (limited) {
    return limited;
  }

  const params = examIdParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const parsed = await parseJsonRequest(request, examPatchSchema, { maxBytes: EXAM_PATCH_MAX_BYTES });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const exam = await updateExam(auth.supabase, auth.user.id, params.data.id, parsed.data);

    if (!exam) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    return NextResponse.json({ exam });
  } catch (error) {
    captureRouteError(error, { route: "api:exams:id:patch", operation: "update", request, userId: auth.user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: Context) {
  const auth = await getRouteUser({ route: "api:exams:id:delete", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:id:delete",
    rules: rateLimitPresets.mutate,
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
    const deleted = await deleteExam(auth.supabase, auth.user.id, params.data.id);

    if (!deleted) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    captureRouteError(error, { route: "api:exams:id:delete", operation: "delete", request, userId: auth.user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
