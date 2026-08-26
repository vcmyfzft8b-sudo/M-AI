import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

import {
  ADMIN_RESTORE_COOKIE,
  IMPERSONATION_COOKIE,
  IMPERSONATION_COOKIE_OPTIONS,
  parseAdminRestorePayload,
} from "./impersonation-cookies.ts";

/**
 * Puts the admin back into their own session and clears the impersonation state.
 *
 * Shared by the Stop button and by sign-out: hitting the app's ordinary logout while impersonating
 * must never reach `supabase.auth.signOut()`, whose default scope is global — that would revoke
 * the *learner's* sessions and sign them out on their own devices, which an admin looking at their
 * account must never cause. For the same reason nothing here signs the impersonation session out;
 * its refresh token is simply dropped and left to expire.
 *
 * Returns null when there is nothing to restore, so callers can fall through to their normal
 * behaviour.
 */
export async function restoreAdminSession(params: {
  request: NextRequest;
  redirectPath: string;
}): Promise<NextResponse | null> {
  const restore = parseAdminRestorePayload(
    params.request.cookies.get(ADMIN_RESTORE_COOKIE)?.value,
  );

  if (!restore) {
    return null;
  }

  const url = params.request.nextUrl.clone();
  url.pathname = params.redirectPath;
  url.search = "";

  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { error } = await supabase.auth.setSession({
    access_token: restore.accessToken,
    refresh_token: restore.refreshToken,
  });

  // An admin session that can no longer be restored (rotated or expired while they were away)
  // must not strand them inside the learner's account: clear everything and send them to the
  // admin login rather than leaving the impersonation session in place.
  if (error) {
    console.warn("[admin-impersonation] Could not restore the admin session", {
      adminEmail: restore.adminEmail,
      error: error.message,
    });

    const loginUrl = params.request.nextUrl.clone();
    loginUrl.pathname = "/admin/login";
    loginUrl.search = "";

    const failed = NextResponse.redirect(loginUrl, { status: 303 });

    params.request.cookies
      .getAll()
      .filter((cookie) => cookie.name.startsWith("sb-"))
      .forEach((cookie) => {
        failed.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
      });

    clearImpersonationCookies(failed);

    return failed;
  }

  const response = applyCookies(NextResponse.redirect(url, { status: 303 }));

  clearImpersonationCookies(response);

  console.warn("[admin-impersonation] Admin returned to their own account", {
    adminEmail: restore.adminEmail,
  });

  return response;
}

export function clearImpersonationCookies(response: NextResponse) {
  for (const name of [ADMIN_RESTORE_COOKIE, IMPERSONATION_COOKIE]) {
    response.cookies.set(name, "", { ...IMPERSONATION_COOKIE_OPTIONS, maxAge: 0 });
  }

  return response;
}
