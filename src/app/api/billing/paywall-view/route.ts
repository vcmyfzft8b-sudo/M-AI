import { NextResponse } from "next/server";
import { z } from "zod";

import { getOptionalUserOrPreviewBypass } from "@/lib/auth";
import { tr } from "@/lib/i18n/server";
import { isNativeUserAgent } from "@/lib/mobile/runtime";
import { LEGACY_PAYWALL_COOKIE, reachedOffer } from "@/lib/paywall-ladder";
import { recordPaywallMoment } from "@/lib/paywall-moments";
import { PAYWALL_REASONS } from "@/lib/paywall-reasons";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";

const viewSchema = z.object({
  reason: z.enum(PAYWALL_REASONS),
  /** A visit already counted (a reload): answer with the rung, record nothing. */
  counted: z.boolean().optional(),
});

/**
 * A paywall reports its moment — a limit met or a browsing offer — so the
 * account's offer climbs a rung (`paywall-ladder.ts`). It answers with the rung reached,
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

  // The account's own ladder, not this device's (`paywall-moments.ts`).
  const { before, after } = await recordPaywallMoment(user.id, parsed.data.reason, parsed.data.counted === true);
  const response = NextResponse.json({
    seen: after,
    advanced: after.length > before.length,
    step: reachedOffer(after).step,
  });

  // The ladder once lived in this cookie; it must not linger on a shared device.
  response.cookies.delete(LEGACY_PAYWALL_COOKIE);

  return response;
}
