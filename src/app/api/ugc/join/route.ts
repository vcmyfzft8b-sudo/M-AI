import { NextResponse } from "next/server";
import { z } from "zod";

import { captureRouteError } from "@/lib/monitoring";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { CREATOR_DISCORD_INVITES } from "@/lib/ugc/creator-campaigns";
import { loadSignable, recordSignature } from "@/lib/ugc/creator-signing.server";
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
 * A creator signing the Terms of Participation from their join link: an accepted
 * applicant (campaign pay), or a creator already in the program signing the contract
 * the admin sent them (their own pay). See `creator-signing.server.ts`.
 *
 * This is the moment the agreement is concluded (Terms, 1.), so it records what was
 * accepted and how: the terms version, the time, the typed name (and a guardian's for
 * a minor), the IP address and the browser. Only then is an applicant's campaign
 * Discord invite handed over. Signing twice changes nothing.
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
  const signable = await loadSignable(token);

  if (!signable) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // An application unlocks its campaign's Discord. A contract goes to a creator who is
  // already in the program, so there is nothing to hand over.
  const discordUrl = signable.kind === "application" ? CREATOR_DISCORD_INVITES[signable.market] : null;

  if (signable.acceptedAt) {
    return NextResponse.json({ discordUrl, acceptedAt: signable.acceptedAt });
  }

  // The page showed one version; if the terms changed under it, they must read the new one.
  if (version !== CREATOR_TERMS_VERSION) {
    return NextResponse.json({ error: "stale" }, { status: 409 });
  }

  if (signable.minor && guardianName.length < 3) {
    return NextResponse.json({ error: "guardian" }, { status: 400 });
  }

  const acceptedAt = new Date().toISOString();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
  const { error } = await recordSignature(signable, {
    signedName,
    guardianName: signable.minor ? guardianName : null,
    ip: ip?.slice(0, 64) ?? null,
    userAgent: request.headers.get("user-agent")?.slice(0, 400) ?? null,
    at: acceptedAt,
  });

  if (error) {
    captureRouteError(error, { route: ROUTE, operation: "record_terms_acceptance", request });

    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }

  return NextResponse.json({ discordUrl, acceptedAt });
}
