import { NextResponse } from "next/server";
import { z } from "zod";

import { updateIn } from "@/lib/admin/db";
import type { UgcCreatorApplicationRow } from "@/lib/database.types";
import { captureRouteError } from "@/lib/monitoring";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { CREATOR_DISCORD_INVITES } from "@/lib/ugc/creator-campaigns";
import { CREATOR_TERMS_VERSION } from "@/lib/ugc/creator-terms";

const ROUTE = "api:ugc:join:post";

const joinSchema = z.object({
  token: z.string().uuid(),
  version: z.string().max(40),
  signedName: z.string().trim().min(3).max(120),
  guardianName: z.string().trim().max(120).optional().default(""),
  agree: z.literal(true),
});

/**
 * An accepted creator agreeing to the Terms of Participation from their join link.
 *
 * This is the moment the agreement is concluded (Terms, 1.), so it records what was
 * accepted and how: the terms version, the time, the typed name (and a guardian's for
 * a minor), the IP address and the browser. Only then is the campaign's Discord
 * invite handed over. Accepting twice changes nothing and answers with the invite.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit({ request, route: ROUTE, rules: rateLimitPresets.creatorJoin });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, joinSchema, { maxBytes: 2_000 });

  if (!parsed.success) {
    return parsed.response;
  }

  const { token, version, signedName, guardianName } = parsed.data;
  const serviceRole = createSupabaseServiceRoleClient();
  const { data } = await serviceRole
    .from("ugc_creator_applications")
    .select("*")
    .eq("join_token", token)
    .maybeSingle();
  const application = data as UgcCreatorApplicationRow | null;

  if (!application || application.status !== "approved" || (application.market !== "si" && application.market !== "balkans")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const discordUrl = CREATOR_DISCORD_INVITES[application.market];

  if (application.terms_accepted_at) {
    return NextResponse.json({ discordUrl, acceptedAt: application.terms_accepted_at });
  }

  // The page showed one version; if the terms changed under it, they must read the new one.
  if (version !== CREATOR_TERMS_VERSION) {
    return NextResponse.json({ error: "stale" }, { status: 409 });
  }

  const isMinor = application.age !== null && application.age < 18;

  if (isMinor && guardianName.length < 3) {
    return NextResponse.json({ error: "guardian" }, { status: 400 });
  }

  const acceptedAt = new Date().toISOString();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;

  const { error } = await updateIn(serviceRole, "ugc_creator_applications", {
    terms_version: CREATOR_TERMS_VERSION,
    terms_accepted_at: acceptedAt,
    terms_signed_name: signedName,
    terms_guardian_name: isMinor ? guardianName : null,
    terms_accepted_ip: ip?.slice(0, 64) ?? null,
    terms_accepted_user_agent: request.headers.get("user-agent")?.slice(0, 400) ?? null,
  })
    .eq("id", application.id)
    // Never overwrite an earlier acceptance if two tabs submit at once.
    .is("terms_accepted_at", null);

  if (error) {
    captureRouteError(error, { route: ROUTE, operation: "record_terms_acceptance", request });

    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }

  return NextResponse.json({ discordUrl, acceptedAt });
}
