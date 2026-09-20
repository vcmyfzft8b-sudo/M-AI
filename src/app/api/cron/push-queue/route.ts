import { NextResponse, type NextRequest } from "next/server";

import { deliverPendingPushNotifications } from "@/lib/mobile/push";
import { captureRouteError } from "@/lib/monitoring";

/**
 * How note notifications actually get delivered.
 *
 * This started as an hourly net under an inline flush, on the assumption that
 * the pipeline run which settles a note is also the thing that sends its
 * notification. Production disagreed: notes settled, the trigger queued every
 * one of them, and the inline flush did not run — so nothing went out until
 * the net swept an hour later, which for "your notes are ready" is most of the
 * way to not having the feature.
 *
 * Chasing which call site failed to fire would have been chasing the same
 * fragility the enqueue already avoids by living in a trigger. So the roles
 * are swapped: the trigger guarantees that a notification is *owed*, this
 * guarantees that it is *sent*, and the inline flush is left in place as an
 * optimisation that makes the common case instant rather than as the thing
 * delivery depends on.
 *
 * Every minute. The claim is a compare-and-swap, so a run overlapping the
 * previous one cannot send anything twice, and a sweep with an empty queue is
 * one indexed query.
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
