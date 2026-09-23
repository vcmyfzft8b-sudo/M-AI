import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserEntitlementState } from "@/lib/billing";
import { AppleAccountMismatch, appleBillingConfigured, verifyAppleConsumable } from "@/lib/mobile/apple";
import { accountDeletionRequested } from "@/lib/mobile/account-lifecycle";
import { creditAppleTutorPurchase } from "@/lib/tutor-credits";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

export const runtime = "nodejs";

/**
 * The App Store tutor hour.
 *
 * GET answers whether this account may open Apple's purchase sheet at all —
 * subscribers only, as on the web: a free account's credits are never spent.
 * POST credits a purchase Apple has already charged for, whoever holds a plan
 * now, because refusing money already taken is not an option.
 */
export async function GET() {
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyCookies(NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 }));
  const state = await getUserEntitlementState(user.id);
  return applyCookies(NextResponse.json(
    { userId: user.id, canPurchase: appleBillingConfigured() && state.hasPaidAccess && !accountDeletionRequested(user) },
    { headers: { "Cache-Control": "no-store" } },
  ));
}

export async function POST(request: Request) {
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const reply = (body: object, status = 200) =>
    applyCookies(NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }));
  if (!appleBillingConfigured()) return reply({ error: await tr("native.unavailable") }, 503);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return reply({ error: await tr("api.unauthorized") }, 401);
  const limited = await enforceRateLimit({ request, userId: user.id, route: "mobile:tutor-credits", rules: rateLimitPresets.mutate });
  if (limited) return limited;
  const body = await parseJsonRequest(request, z.object({ signedTransaction: z.string().min(1).max(24_000) }).strict(), { maxBytes: 26_000 });
  if (!body.success) return body.response;
  try {
    const purchase = await verifyAppleConsumable(body.data.signedTransaction, user.id);
    // A refunded hour is finished on the device and never credited.
    if (purchase.revoked) return reply({ verified: true, credited: false, revoked: true });
    const result = await creditAppleTutorPurchase({ userId: user.id, ...purchase });
    return reply({ verified: true, credited: result.credited });
  } catch (error) {
    if (error instanceof AppleAccountMismatch) return reply({ error: await tr("native.otherAccount") }, 409);
    console.error("Apple tutor hour not credited", { stage: "verify_or_credit" });
    return reply({ error: await tr("native.verifyFailed") }, 503);
  }
}
