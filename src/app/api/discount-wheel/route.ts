import { NextResponse } from "next/server";

import { getOptionalUserOrPreviewBypass } from "@/lib/auth";
import {
  getDiscountWheelState,
  markDiscountWheelSpent,
  spinDiscountWheel,
} from "@/lib/discount-wheel";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { tr } from "@/lib/i18n/server";

/** Whether this account still has a spin, and what it already won. */
export async function GET() {
  // Through the same helper as every other route, so the preview bypass can
  // reach the wheel instead of being told it is not signed in.
  const user = await getOptionalUserOrPreviewBypass();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  return NextResponse.json(await getDiscountWheelState(user.id));
}

/** Spins the wheel. Idempotent: a second call returns the first prize. */
export async function POST(request: Request) {
  // Through the same helper as every other route, so the preview bypass can
  // reach the wheel instead of being told it is not signed in.
  const user = await getOptionalUserOrPreviewBypass();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:discount-wheel:post",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  try {
    return NextResponse.json(await spinDiscountWheel(user.id));
  } catch (error) {
    console.error("[discount-wheel] spin failed", error);
    return NextResponse.json(
      { error: await tr("api.prizeSaveFailed") },
      { status: 500 },
    );
  }
}

/**
 * Gives the prize up. Sent when the offer is closed without a purchase.
 *
 * The offer is "now or not at all", so walking away from it spends the
 * discount — without this the countdown means nothing, because the sheet could
 * simply be reopened, or checkout reached from anywhere else, and the coupon
 * would still be attached.
 */
export async function DELETE() {
  const user = await getOptionalUserOrPreviewBypass();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  await markDiscountWheelSpent(user.id);

  return NextResponse.json({ ok: true });
}
