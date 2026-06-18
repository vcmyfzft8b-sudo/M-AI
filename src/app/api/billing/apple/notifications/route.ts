import { NextResponse } from "next/server";
import { z } from "zod";

import {
  syncAppStoreTransactionEntitlement,
  verifyAppStoreNotification,
} from "@/lib/apple-app-store";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";

const notificationSchema = z.object({
  signedPayload: z.string().min(1),
});

export async function POST(request: Request) {
  const limited = await enforceRateLimit({
    request,
    route: "api:billing:apple:notifications:post",
    rules: rateLimitPresets.stripeWebhook,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, notificationSchema, {
    maxBytes: 64 * 1024,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const notification = await verifyAppStoreNotification(parsed.data.signedPayload);

    if (notification.transaction) {
      await syncAppStoreTransactionEntitlement({
        transaction: notification.transaction,
      });
    }

    return NextResponse.json({
      ok: true,
      notificationType: notification.notificationType,
      subtype: notification.subtype,
      processedTransaction: Boolean(notification.transaction),
    });
  } catch (error) {
    console.error("App Store notification processing failed", {
      error,
    });

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "App Store notification could not be processed.",
      },
      { status: 400 },
    );
  }
}
