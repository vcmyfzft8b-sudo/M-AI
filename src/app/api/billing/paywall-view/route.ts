import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getOptionalUserOrPreviewBypass } from "@/lib/auth";
import { tr } from "@/lib/i18n/server";
import { isNativeUserAgent } from "@/lib/mobile/runtime";
import {
  PAYWALL_SEEN_COOKIE,
  PAYWALL_SEEN_COOKIE_MAX_AGE,
  reachedOffer,
  readSeenReasons,
  recordSeenReason,
  writeSeenReasons,
} from "@/lib/paywall-ladder";
import { PAYWALL_REASONS } from "@/lib/paywall-reasons";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";

const viewSchema = z.object({
  reason: z.enum(PAYWALL_REASONS),
});

/**
 * A paywall reports its moment — a limit met or a browsing offer — so the
 * offer climbs a rung (`paywall-ladder.ts`). It answers with the rung reached,
 * which the paywall then shows, and whether this moment lifted the price,
 * which decides what the browsing offer's headline may claim.
 */
export async function POST(request: Request) {
  // The app's prices are Apple's; it never moves down the ladder.
  if (isNativeUserAgent(request.headers.get("user-agent"))) {
    return NextResponse.json({ seen: [], advanced: false, step: 1 });
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
  const before = readSeenReasons(jar.get(PAYWALL_SEEN_COOKIE)?.value);
  const seen = recordSeenReason(before, parsed.data.reason);
  const response = NextResponse.json({
    seen,
    advanced: seen.length > before.length,
    step: reachedOffer(seen).step,
  });

  response.cookies.set(PAYWALL_SEEN_COOKIE, writeSeenReasons(seen), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PAYWALL_SEEN_COOKIE_MAX_AGE,
  });

  return response;
}
