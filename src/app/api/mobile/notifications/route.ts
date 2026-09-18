import { NextResponse } from "next/server";
import { z } from "zod";
import { appleNotificationRetryable, verifyAppleNotification, saveAppleTransaction } from "@/lib/mobile/apple";
import { captureBackgroundError, captureRouteError } from "@/lib/monitoring";
import { parseJsonRequest } from "@/lib/request-validation";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (process.env.APPLE_IAP_ENABLED !== "true") return new NextResponse(null, { status: 503 });
  const parsed = await parseJsonRequest(request, z.object({ signedPayload: z.string().min(1).max(60_000) }).strict(), { maxBytes: 64_000 });
  if (!parsed.success) return parsed.response;
  try {
    const notification = await verifyAppleNotification(parsed.data.signedPayload);
    if (notification.data?.signedTransactionInfo) {
      await saveAppleTransaction(notification.data.signedTransactionInfo);
    }
    // Acknowledge only after persistence. Monotonic transaction writes also dedupe retries.
    return NextResponse.json({ received: true });
  } catch (error) {
    // Apple reads only the status, and resends anything but a 200 at 1, 12, 24, 48 and 72 hours.
    // Ask for that when a later attempt could succeed; a payload we will never accept is
    // acknowledged instead, so one dead notification cannot spend three days as a 5xx.
    const route = "POST /api/mobile/notifications";
    if (appleNotificationRetryable(error)) {
      captureRouteError(error, { route, operation: "apple_notification_retry", request });
      return new NextResponse(null, { status: 503 });
    }
    // The request is finished and correct; something inside it was refused, and nothing but a
    // report says so. Silence here is what left the 503s on the dashboard with no explanation.
    captureBackgroundError(error, { operation: "apple_notification_rejected", tags: { route },
      extra: { vercelRequestId: request.headers.get("x-vercel-id") } });
    return NextResponse.json({ received: true, accepted: false });
  }
}
