import { NextResponse, type NextRequest } from "next/server";

import { isApifyConfigured } from "@/lib/ugc/apify";
import { getPendingSyncRun, pollAndIngest, startSync } from "@/lib/ugc/sync";

/**
 * Scheduled TikTok collection.
 *
 * Each call does two things: finish any run that Apify has completed since last
 * time, then queue a fresh one if none is in flight. Running it a few times a
 * day gives the dashboard one snapshot per creator per day, which is what the
 * day-over-day view deltas are built on.
 *
 * Wired up in `vercel.json`. Vercel Cron sends `Authorization: Bearer
 * $CRON_SECRET`; `INTERNAL_JOB_SECRET` is accepted too so the job can be
 * triggered from the existing tooling.
 */

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  const secrets = [process.env.CRON_SECRET, process.env.INTERNAL_JOB_SECRET]
    .map((secret) => secret?.trim())
    .filter((secret): secret is string => Boolean(secret));

  if (secrets.length === 0) {
    // Refuse rather than run unauthenticated: this endpoint spends money.
    return false;
  }

  return secrets.some((secret) => timingSafeEqual(secret, provided));
}

/** Constant-time compare, so a wrong secret cannot be guessed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isApifyConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "APIFY_TOKEN is not configured." },
      { status: 200 },
    );
  }

  const ingested = await pollAndIngest().catch((error: unknown) => ({
    status: "error" as const,
    syncRunId: null,
    videosSeen: 0,
    videosCreated: 0,
    videosUpdated: 0,
    accountsSynced: 0,
    error: error instanceof Error ? error.message : "Ingest failed.",
  }));

  // A run that is still going must not be followed by a second one.
  const pending = await getPendingSyncRun();

  const started = pending
    ? { started: false as const, reason: "A collection run is already in flight." }
    : await startSync({ trigger: "cron", startedBy: "cron" });

  return NextResponse.json({
    ok: true,
    ingested,
    started,
  });
}
