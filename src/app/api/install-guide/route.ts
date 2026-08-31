import { NextResponse } from "next/server";

import { getOptionalUserOrPreviewBypass } from "@/lib/auth";
import { markInstallGuideSeenForUser } from "@/lib/install-guide-state";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { tr } from "@/lib/i18n/server";

/**
 * Records that the "add to home screen" guide was opened, so the red dot on
 * the settings gear and on the row goes away on every device this account
 * signs in on rather than only in the browser it was tapped in.
 */
export async function POST(request: Request) {
  // The same helper every other route uses, so the preview bypass reaches this
  // instead of being told it is not signed in.
  const user = await getOptionalUserOrPreviewBypass();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:install-guide:post",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  try {
    await markInstallGuideSeenForUser(user.id);
  } catch (error) {
    // Nothing the caller can do about it, and nothing it needs to: the badge
    // is already gone locally, and the next visit tries again.
    console.error("[install-guide] mark seen failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
