import { NextResponse } from "next/server";

import { getGiveawayLeaderboard } from "@/lib/giveaway";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { tr } from "@/lib/i18n/server";

/**
 * The public standings, for the landing page. Names arrive already masked
 * (see `maskGiveawayName`), so nothing here is anyone's address. Cached at
 * the edge for a short while: the board is one query, but a landing page
 * gets crawled, and every visitor polling it should not each reach the
 * database.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit({
    request,
    route: "api:giveaway:leaderboard:get",
    rules: rateLimitPresets.listRead,
  });

  if (limited) {
    return limited;
  }

  try {
    const leaderboard = await getGiveawayLeaderboard({
      fallbackName: await tr("giveaway.anonymous"),
    });

    return NextResponse.json(leaderboard, {
      headers: {
        "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    console.error("[giveaway] leaderboard failed", error);

    return NextResponse.json({ error: await tr("giveaway.error.load") }, { status: 500 });
  }
}
