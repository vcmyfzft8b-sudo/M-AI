import { NextResponse } from "next/server";

import { getOptionalUserOrPreviewBypass } from "@/lib/auth";
import {
  ensureGiveawayCode,
  getGiveawayLeaderboard,
  getGiveawayProgress,
  GiveawayUnavailableError,
} from "@/lib/giveaway";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { tr } from "@/lib/i18n/server";

/**
 * The signed-in view of the giveaway: the account's code, how many friends it
 * has brought, and the standings. The giveaway screen polls this while it is
 * open so the board moves without a reload.
 */
export async function GET(request: Request) {
  const user = await getOptionalUserOrPreviewBypass();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:giveaway:get",
    rules: rateLimitPresets.listRead,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  try {
    const [code, progress, leaderboard] = await Promise.all([
      ensureGiveawayCode({ userId: user.id, email: user.email ?? null }),
      getGiveawayProgress(user.id),
      getGiveawayLeaderboard({ fallbackName: await tr("giveaway.anonymous") }),
    ]);

    return NextResponse.json(
      { code: code.code, progress, leaderboard },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[giveaway] state failed", error);

    return NextResponse.json(
      {
        error: await tr(
          error instanceof GiveawayUnavailableError
            ? "giveaway.error.unavailable"
            : "giveaway.error.load",
        ),
      },
      { status: error instanceof GiveawayUnavailableError ? 503 : 500 },
    );
  }
}
