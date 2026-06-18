import { NextResponse } from "next/server";
import { z } from "zod";

import {
  syncAppStoreTransactionEntitlement,
  verifyAppStoreTransaction,
} from "@/lib/apple-app-store";
import { getViewerAppState } from "@/lib/billing";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";

const transactionSchema = z.object({
  signedTransactionInfo: z.string().min(1),
});

export async function POST(request: Request) {
  const appState = await getViewerAppState();

  if (!appState) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:billing:apple:transactions:post",
    rules: rateLimitPresets.mutate,
    userId: appState.user.id,
  });

  if (limited) {
    return limited;
  }

  if (!appState.onboardingComplete) {
    return NextResponse.json({ error: "Najprej dokončaj uvodno nastavitev." }, { status: 400 });
  }

  const parsed = await parseJsonRequest(request, transactionSchema, {
    maxBytes: 8192,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const transaction = await verifyAppStoreTransaction(parsed.data.signedTransactionInfo);

    if (transaction.appAccountToken && transaction.appAccountToken !== appState.user.id) {
      return NextResponse.json(
        { error: "App Store nakup ne pripada temu uporabniškemu računu." },
        { status: 403 },
      );
    }

    await syncAppStoreTransactionEntitlement({
      transaction,
      userId: appState.user.id,
    });

    return NextResponse.json({
      ok: true,
      entitlement: {
        plan: transaction.plan,
        status: transaction.status,
        currentPeriodEnd: transaction.expiresAt,
        environment: transaction.environment,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nakupa prek App Store ni bilo mogoče potrditi.",
      },
      { status: 400 },
    );
  }
}
