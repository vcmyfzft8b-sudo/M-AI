import { NextResponse, type NextRequest } from "next/server";

import { captureRouteError } from "@/lib/monitoring";
import { sweepPendingUploads } from "@/lib/ugc/pending-upload-sweep";

/**
 * Deletes creator-program sample videos that were uploaded but never became part of an
 * application (an abandoned form, a duplicate email), once they are a day old. Runs daily;
 * the rule is in `pending-upload-plan.ts`, this route is only the schedule and the secret.
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
    const outcome = await sweepPendingUploads();

    console.log("[ugc-pending-uploads] Sweep complete", outcome);

    if (outcome.errors.length > 0) {
      captureRouteError(new Error(`Pending-upload sweep could not delete some files: ${outcome.errors.join("; ")}`), {
        route: "cron:ugc-pending-uploads",
        operation: "sweepPendingUploads",
        extra: { outcome },
      });
    }

    return NextResponse.json({ sweptAt: new Date().toISOString(), ...outcome });
  } catch (error) {
    captureRouteError(error, { route: "cron:ugc-pending-uploads", operation: "sweepPendingUploads", request });

    return NextResponse.json({ error: "Sweep failed." }, { status: 500 });
  }
}
