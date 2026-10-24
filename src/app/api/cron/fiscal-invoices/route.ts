import { NextResponse, type NextRequest } from "next/server";

import { retryPendingFiscalInvoices } from "@/lib/fiscal/fiscal-invoices";
import { captureRouteError } from "@/lib/monitoring";

/**
 * Sends FURS every fiscal invoice it has not confirmed yet, and emails every confirmed one the
 * customer has not received. ZDavPR allows two working days after an outage or a FURS error, so
 * every 15 minutes leaves a wide margin. Does nothing until fiscal verification is configured
 * (docs/fiscal-verification.md).
 */

export const runtime = "nodejs";
export const maxDuration = 120;
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
    const outcome = await retryPendingFiscalInvoices();

    console.log("[fiscal-invoices] Retry complete", outcome);

    return NextResponse.json({ retriedAt: new Date().toISOString(), ...outcome });
  } catch (error) {
    captureRouteError(error, { route: "cron:fiscal-invoices", operation: "retryPendingFiscalInvoices", request });

    return NextResponse.json({ error: "Retry failed." }, { status: 500 });
  }
}
