import { NextResponse } from "next/server";
import { z } from "zod";

import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { getRouteUser } from "@/lib/supabase/server";
import { getTutorAllowance, settleTutorGrant, toClientUsage } from "@/lib/tutor-usage";
import { routeIdParamSchema, uuidSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

const usageSchema = z.object({
  grantId: uuidSchema,
  /* One slice is five minutes; anything past that is clamped server-side anyway. */
  secondsUsed: z.number().min(0).max(3_600),
});

/**
 * Reports what a slice of talking time actually cost, and answers with what is left.
 *
 * Sent when the walkthrough stops, when the tab is hidden, and periodically while it runs —
 * so a browser that is closed mid-session has usually already paid for most of what it used.
 * Whatever it does not report is covered by the slice itself, which was reserved up front.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getRouteUser({ route: "POST /api/lectures/[id]/tutor/usage", request });

  if (!auth.user) {
    return auth.response;
  }

  const { user } = auth;

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:tutor:usage",
    rules: rateLimitPresets.progress,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  if (!routeIdParamSchema.safeParse(await context.params).success) {
    return NextResponse.json({ error: await tr("api.invalidLectureId") }, { status: 400 });
  }

  const parsed = await parseJsonRequest(request, usageSchema, { maxBytes: 512 });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const allowance = await settleTutorGrant({
      userId: user.id,
      grantId: parsed.data.grantId,
      secondsUsed: parsed.data.secondsUsed,
      feature: "tutor",
    });

    return NextResponse.json({ usage: toClientUsage(allowance) });
  } catch (error) {
    console.error("[tutor] settling a usage grant failed", error);

    /*
     * A failed settlement must not look like a failed session: the learner has already had
     * the time, and the grant stays open to be charged in full. Answer with what is known.
     */
    return NextResponse.json({ usage: toClientUsage(await getTutorAllowance(user.id, "tutor")) });
  }
}

/** What is left, for the meter — read on opening the screen, before anything is granted. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getRouteUser({ route: "GET /api/lectures/[id]/tutor/usage", request });

  if (!auth.user) {
    return auth.response;
  }

  const { user } = auth;

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:tutor:usage:get",
    rules: rateLimitPresets.detailRead,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  if (!routeIdParamSchema.safeParse(await context.params).success) {
    return NextResponse.json({ error: await tr("api.invalidLectureId") }, { status: 400 });
  }

  return NextResponse.json({ usage: toClientUsage(await getTutorAllowance(user.id, "tutor")) });
}
