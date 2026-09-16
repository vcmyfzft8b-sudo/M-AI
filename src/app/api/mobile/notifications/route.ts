import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyAppleNotification, saveAppleTransaction } from "@/lib/mobile/apple";
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
  } catch {
    // Apple retries temporary certificate/network/database failures.
    return new NextResponse(null, { status: 503 });
  }
}
