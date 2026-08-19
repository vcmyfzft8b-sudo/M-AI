import { NextResponse, type NextRequest } from "next/server";

import { isApifyConfigured } from "@/lib/ugc/apify";
import {
  getLatestSyncRun,
  getPendingSyncRun,
  pollAndIngest,
  reclassifyAll,
  startSync,
} from "@/lib/ugc/sync";

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

/**
 * Minimum gap between two collections started by this endpoint.
 *
 * The schedule is daily, so this never trips in normal operation. It exists
 * because every run costs Apify credit: without it, triggering the endpoint by
 * hand — to settle a finished run, say — would immediately start another one.
 */
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

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

  // `reclassify=1` re-runs detection over everything already stored, including
  // the AI pass on mixed accounts. Useful after a rule change without paying
  // for a fresh scrape.
  if (request.nextUrl.searchParams.get("reclassify") === "1") {
    const result = await reclassifyAll();
    return NextResponse.json({ ok: true, reclassified: result });
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
  const latest = await getLatestSyncRun();

  const finishedAt = latest?.finished_at
    ? new Date(latest.finished_at).getTime()
    : null;
  const tooSoon =
    finishedAt !== null && Date.now() - finishedAt < MIN_INTERVAL_MS;

  // `force=1` overrides the debounce and `posts=` widens the per-creator pull,
  // which is how a one-off deep backfill is run without changing the schedule
  // or the steady-state cost. Both are behind the same secret as the job.
  const force = request.nextUrl.searchParams.get("force") === "1";
  const handles = request.nextUrl.searchParams
    .getAll("handle")
    .map((handle) => handle.trim().replace(/^@/, ""))
    .filter(Boolean);
  const postsParam = Number(request.nextUrl.searchParams.get("posts"));
  const postsPerProfile =
    Number.isFinite(postsParam) && postsParam > 0 && postsParam <= 200
      ? Math.floor(postsParam)
      : undefined;

  const started = pending
    ? { started: false as const, reason: "A collection run is already in flight." }
    : tooSoon && !force
      ? {
          started: false as const,
          reason: "A collection ran recently; skipping to avoid a duplicate spend.",
        }
      : await startSync({
          trigger: "cron",
          startedBy: force ? "cron:forced" : "cron",
          postsPerProfile,
          handles: handles.length > 0 ? handles : undefined,
        });

  return NextResponse.json({
    ok: true,
    ingested,
    started,
  });
}
