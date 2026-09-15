import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eraseDueAccounts } from "@/lib/mobile/account-erasure";
import { captureRouteError } from "@/lib/monitoring";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(supplied)
    || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const outcome = await eraseDueAccounts();
    if (outcome.failed) throw new Error(`Account erasure incomplete for ${outcome.failed} queued request(s)`);
    return NextResponse.json(outcome);
  } catch (error) {
    captureRouteError(error, { route: "cron:account-erasure", operation: "eraseDueAccounts" });
    return NextResponse.json({ error: "Account erasure will retry" }, { status: 500 });
  }
}
