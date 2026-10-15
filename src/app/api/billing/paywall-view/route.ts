import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getOptionalUserOrPreviewBypass } from "@/lib/auth";
import { tr } from "@/lib/i18n/server";
import { isNativeUserAgent } from "@/lib/mobile/runtime";
import {
  PAYWALL_STEP_COOKIE,
  PAYWALL_STEP_COOKIE_MAX_AGE,
  advancePaywallStep,
  readPaywallStep,
} from "@/lib/paywall-ladder";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";

const viewSchema = z.object({
  step: z.number().int().min(1).max(10),
});

/**
 * The paywall reports the step it showed, and the next one will offer more
 * (`paywall-ladder.ts`). The cookie only ever moves one step per call, so this
 * cannot be used to jump to the bottom of the ladder.
 */
export async function POST(request: Request) {
  // The app's prices are Apple's; it never moves down the ladder.
  if (isNativeUserAgent(request.headers.get("user-agent"))) {
    return NextResponse.json({ step: 1 });
  }

  const user = await getOptionalUserOrPreviewBypass();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:billing:paywall-view:post",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, viewSchema, { maxBytes: 256 });

  if (!parsed.success) {
    return parsed.response;
  }

  const jar = await cookies();
  const step = advancePaywallStep(readPaywallStep(jar.get(PAYWALL_STEP_COOKIE)?.value), parsed.data.step);
  const response = NextResponse.json({ step });

  response.cookies.set(PAYWALL_STEP_COOKIE, String(step), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PAYWALL_STEP_COOKIE_MAX_AGE,
  });

  return response;
}
