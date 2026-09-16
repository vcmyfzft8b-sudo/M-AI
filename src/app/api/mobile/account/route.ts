import { NextResponse } from "next/server";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { getUserEntitlementState } from "@/lib/billing";
import { appleBillingConfigured } from "@/lib/mobile/apple";

export async function GET() {
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const state = user ? await getUserEntitlementState(user.id) : null;
  return applyCookies(NextResponse.json(user ? { userId: user.id, canPurchase: appleBillingConfigured() && !state?.hasPaidAccess } : { error: "Unauthorized" }, {
    status: user ? 200 : 401, headers: { "Cache-Control": "no-store" },
  }));
}
