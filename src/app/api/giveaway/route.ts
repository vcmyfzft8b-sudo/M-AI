import { NextResponse } from "next/server";

import { getOptionalUserOrPreviewBypass } from "@/lib/auth";
import {
  ensureGiveawayCode,
  getGiveawayCode,
  getGiveawayLeaderboard,
  getGiveawayProgress,
  GiveawayUnavailableError,
} from "@/lib/giveaway";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { tr } from "@/lib/i18n/server";

/**
 * The signed-in view of the giveaway: the account's code (null until it has
 * asked for one), how many friends it has brought, and the standings. The
 * giveaway screen polls this while it is open so the board moves without a
 * reload. Reading never creates anything; POST does.
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
      getGiveawayCode(user.id),
      getGiveawayProgress(user.id),
      getGiveawayLeaderboard({ fallbackName: await tr("giveaway.anonymous") }),
    ]);

    return NextResponse.json(
      { code: code?.code ?? null, progress, leaderboard },
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

/**
 * Creates the account's code — the "Get my code" button. Accounts that
 * finished onboarding after the campaign began already have one (the
 * onboarding route creates it), so this is mostly for accounts that predate
 * it, and only for the ones that ask. Idempotent: a second call returns the
 * same code.
 */
export async function POST(request: Request) {
  const user = await getOptionalUserOrPreviewBypass();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:giveaway:post",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  try {
    const code = await ensureGiveawayCode({ userId: user.id, email: user.email ?? null });

    return NextResponse.json({ code: code.code });
  } catch (error) {
    console.error("[giveaway] code creation failed", error);

    return NextResponse.json(
      {
        error: await tr(
          error instanceof GiveawayUnavailableError
            ? "giveaway.error.unavailable"
            : "giveaway.code.getFailed",
        ),
      },
      { status: error instanceof GiveawayUnavailableError ? 503 : 500 },
    );
  }
}
