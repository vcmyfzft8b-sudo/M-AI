import { NextResponse, type NextRequest } from "next/server";

import { requireAdminApi } from "@/lib/admin/auth";
import {
  ADMIN_RESTORE_COOKIE,
  IMPERSONATION_COOKIE,
  IMPERSONATION_COOKIE_OPTIONS,
  encodeCookiePayload,
  mintImpersonationTokenHash,
  recordImpersonationEvent,
  resolveImpersonationTarget,
} from "@/lib/admin/impersonation";
import {
  createSupabaseRouteHandlerClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

/**
 * Starts an impersonation session: the admin ends this request holding a genuine session for the
 * target account, so every page and API route behind it answers as that learner's own app.
 *
 * A route handler rather than a server action because session cookies can only be written through
 * `createSupabaseRouteHandlerClient` + `applyCookies` — the server-component client's `setAll` is
 * a deliberate no-op (src/lib/supabase/server.ts).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectTo(request: NextRequest, pathname: string, search = "") {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = search;

  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminApi();

  if (!admin.ok) {
    return admin.response;
  }

  const formData = await request.formData().catch(() => null);
  const targetUserId =
    typeof formData?.get("user_id") === "string" ? String(formData.get("user_id")).trim() : "";

  if (!targetUserId) {
    return redirectTo(request, "/admin/users", "?impersonation=missing-user");
  }

  if (targetUserId === admin.context.user.id) {
    return redirectTo(request, "/admin/users", "?impersonation=self");
  }

  const target = await resolveImpersonationTarget(targetUserId);

  if (!target?.email) {
    return redirectTo(request, "/admin/users", "?impersonation=unknown-user");
  }

  // The admin's own tokens, captured before their cookies are replaced, so Stop is a cookie swap
  // rather than a fresh login. Read from a separate client: the route-handler client's cookie
  // buffer is claimed below by the impersonation session.
  const readClient = await createSupabaseServerClient();
  const {
    data: { session: adminSession },
  } = await readClient.auth.getSession();

  if (!adminSession?.access_token || !adminSession.refresh_token) {
    return redirectTo(request, "/admin/users", "?impersonation=no-admin-session");
  }

  let response: NextResponse;

  try {
    const tokenHash = await mintImpersonationTokenHash(target.email);
    const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
    const { error } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: tokenHash,
    });

    if (error) {
      throw new Error(error.message);
    }

    response = applyCookies(redirectTo(request, "/app"));
  } catch (error) {
    console.error("[admin-impersonation] Could not start impersonation", {
      adminEmail: admin.context.user.email ?? null,
      targetUserId,
      error: error instanceof Error ? error.message : String(error),
    });

    return redirectTo(request, "/admin/users", "?impersonation=failed");
  }

  response.cookies.set(
    ADMIN_RESTORE_COOKIE,
    encodeCookiePayload({
      accessToken: adminSession.access_token,
      refreshToken: adminSession.refresh_token,
      adminEmail: admin.context.user.email ?? null,
    }),
    IMPERSONATION_COOKIE_OPTIONS,
  );
  response.cookies.set(
    IMPERSONATION_COOKIE,
    encodeCookiePayload({
      targetUserId: target.id,
      targetEmail: target.email,
      adminEmail: admin.context.user.email ?? null,
      startedAt: new Date().toISOString(),
    }),
    IMPERSONATION_COOKIE_OPTIONS,
  );

  await recordImpersonationEvent({
    adminEmail: admin.context.user.email ?? null,
    targetUserId: target.id,
    targetEmail: target.email,
    userAgent: request.headers.get("user-agent"),
  });

  return response;
}
