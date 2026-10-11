import { NextResponse } from "next/server";
import { z } from "zod";

import { updateIn } from "@/lib/admin/db";
import { captureRouteError } from "@/lib/monitoring";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { loadSignable } from "@/lib/ugc/creator-signing.server";

const ROUTE = "api:ugc:join:discord:post";

const schema = z.object({ token: z.string().uuid() });

/**
 * A signed applicant opened their campaign's Discord invite from the join page (the last
 * step after signing). Recorded once, so the page says "you're in" from then on and the
 * admin card shows it. This is the invite being opened, not Discord membership: the site
 * cannot see who is inside a Discord server.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit({ request, route: ROUTE, rules: rateLimitPresets.creatorJoin });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, schema, { maxBytes: 500 });

  if (!parsed.success) {
    return parsed.response;
  }

  const signable = await loadSignable(parsed.data.token);

  // Only after signing, and only an applicant has a Discord step.
  if (!signable || signable.kind !== "application" || !signable.acceptedAt) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (signable.discordOpenedAt) {
    return NextResponse.json({ openedAt: signable.discordOpenedAt });
  }

  const openedAt = new Date().toISOString();
  const { error } = await updateIn(createSupabaseServiceRoleClient(), "ugc_creator_applications", {
    discord_opened_at: openedAt,
  })
    .eq("id", signable.id)
    .is("discord_opened_at", null);

  if (error) {
    captureRouteError(error, { route: ROUTE, operation: "record_discord_opened", request });

    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }

  return NextResponse.json({ openedAt });
}
