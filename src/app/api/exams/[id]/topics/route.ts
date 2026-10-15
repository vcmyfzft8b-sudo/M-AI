import { NextResponse } from "next/server";

import { planPendingTopics } from "@/lib/exams/exams-server";
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
    const planned = await planPendingTopics(auth.supabase, auth.user.id, params.data.id);

    if (planned === null) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    return NextResponse.json({ planned });
  } catch (error) {
    captureRouteError(error, { route: "api:exams:topics:post", operation: "plan", request, userId: auth.user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
