import { NextResponse, type NextRequest } from "next/server";

import { sweepStalledLectures } from "@/lib/lecture-stall-sweep";
import { captureRouteError } from "@/lib/monitoring";

/**
 * Settles lectures whose pipeline run died without recording anything.
 *
 * Recovery used to live only in the lecture GET handler, so it ran when a learner reopened the
 * note and never otherwise — leaving a slow trickle of lectures stuck on a spinner that would
 * never resolve, invisible in the failure numbers because a stuck row is not a failed one.
 *
 * Runs hourly. The policy, and the three guards that stop it spending money in a loop, are in
 * `lecture-stall-plan.ts`; this route is only the schedule and the secret.
 */

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

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

  try {
    const outcome = await sweepStalledLectures();

    // One line per run, so the sweep's own history is readable in the platform logs even on the
    // many runs where it finds nothing to do.
    console.log("[stalled-lectures] Sweep complete", outcome);

    // A lecture the sweep could neither resume nor fail is the one case worth a person's
    // attention: it will be picked up again next hour, but a persistent one never settles.
    if (outcome.errors.length > 0) {
      captureRouteError(
        new Error(
          `Stalled-lecture sweep could not settle ${outcome.errors.length} lecture(s): ${outcome.errors
            .map((entry) => `${entry.lectureId} (${entry.message})`)
            .join("; ")}`,
        ),
        {
          route: "cron:stalled-lectures",
          operation: "sweepStalledLectures",
          extra: { outcome },
        },
      );
    }

    return NextResponse.json({ sweptAt: new Date().toISOString(), ...outcome });
  } catch (error) {
    captureRouteError(error, {
      route: "cron:stalled-lectures",
      operation: "sweepStalledLectures",
      request,
    });

    return NextResponse.json({ error: "Sweep failed." }, { status: 500 });
  }
}
