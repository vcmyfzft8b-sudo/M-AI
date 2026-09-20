import { NextResponse, type NextRequest } from "next/server";

import { deliverPendingPushNotifications } from "@/lib/mobile/push";
import { captureRouteError } from "@/lib/monitoring";

/**
 * The safety net under note notifications.
 *
 * The queue is normally drained the moment a note settles, by the pipeline run
 * that settled it. This exists for the runs that do not get that far: a
 * function that times out between the database commit and the flush, an APNs
 * outage, a note settled by the stall sweep rather than by its own pipeline.
 *
 * Hourly, which is the wrong cadence for a notification and the right one for
 * a net — anything it catches is already late, and the queue drops attempts
 * that have aged past usefulness rather than delivering yesterday's news.
 */

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

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

function isAuthorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  const secrets = [process.env.CRON_SECRET, process.env.INTERNAL_JOB_SECRET]
    .map((secret) => secret?.trim())
    .filter((secret): secret is string => Boolean(secret));

  if (secrets.length === 0) {
    return false;
  }

  return secrets.some((secret) => timingSafeEqual(secret, provided));
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const outcome = await deliverPendingPushNotifications();

    // Only when it found work: a net that catches nothing should be silent,
    // and this runs 24 times a day.
    if (outcome.claimed > 0) {
      console.log("[push-queue] Drain complete", outcome);
    }

    return NextResponse.json({ drainedAt: new Date().toISOString(), ...outcome });
  } catch (error) {
    captureRouteError(error, {
      route: "cron:push-queue",
      operation: "deliverPendingPushNotifications",
      request,
    });

    return NextResponse.json({ error: "Drain failed." }, { status: 500 });
  }
}
