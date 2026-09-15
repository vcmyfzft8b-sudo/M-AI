import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseRouteHandlerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/billing";
import { IMPERSONATION_COOKIE, ADMIN_RESTORE_COOKIE } from "@/lib/admin/impersonation-cookies";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { tr } from "@/lib/i18n/server";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin !== request.nextUrl.origin || request.cookies.has(IMPERSONATION_COOKIE) || request.cookies.has(ADMIN_RESTORE_COOKIE)) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 403 });
  }
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyCookies(NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 }));
  const limited = await enforceRateLimit({ request, userId: user.id, route: "account:delete", rules: rateLimitPresets.mutate });
  if (limited) return limited;
  const parsed = await parseJsonRequest(request, z.object({ confirmation: z.literal("delete-my-account") }).strict(), { maxBytes: 1024 });
  if (!parsed.success) return parsed.response;
  const service = createSupabaseServiceRoleClient();
  try {
    let appleManualRevocationRequired = false;
    if (user.identities?.some(identity => identity.provider === "apple")) {
      const grants = await service.from("apple_auth_grants").select("apple_subject").eq("user_id", user.id);
      if (grants.error) throw grants.error;
      const savedGrants = (grants.data ?? []) as { apple_subject: string }[];
      const subjects = user.identities.filter(identity => identity.provider === "apple").map(identity => identity.identity_data?.sub);
      // TN3194 requires deletion even when an older integration retained no
      // revocable token. Provide Apple's manual disconnection instructions.
      appleManualRevocationRequired = !subjects.every(subject => subject && savedGrants.some(grant => grant.apple_subject === subject));
    }
    // Cancel recurring web billing before removing its customer/account mapping.
    // Apple cancellations remain controlled by the user in Apple's system sheet.
    const { data: profileData, error: profileError } = await service.from("profiles").select("stripe_customer_id").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    const profile = profileData as { stripe_customer_id: string | null } | null;
    if (profile?.stripe_customer_id) {
      const stripe = getStripeClient();
      for await (const subscription of stripe.subscriptions.list({ customer: profile.stripe_customer_id, status: "all", limit: 100 })) {
        if (!["canceled", "incomplete_expired"].includes(subscription.status)) await stripe.subscriptions.cancel(subscription.id);
      }
    }

    // Atomically block access and retain a durable cleanup job while signed
    // upload tokens and already-running requests drain.
    const queued = await service.rpc("request_account_deletion", { target_user_id: user.id } as never);
    if (queued.error) throw queued.error;
    await supabase.auth.signOut({ scope: "local" });
    const response = applyCookies(NextResponse.json({ deletionRequested: true, appleManualRevocationRequired }, { status: 202, headers: { "Cache-Control": "no-store" } }));
    request.cookies.getAll().filter(cookie => cookie.name.startsWith("sb-")).forEach(cookie => response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 }));
    return response;
  } catch {
    return applyCookies(NextResponse.json({ error: await tr("native.deleteFailed") }, { status: 503 }));
  }
}
