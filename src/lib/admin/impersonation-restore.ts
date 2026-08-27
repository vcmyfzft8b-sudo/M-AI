import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import {
  createSupabaseRouteHandlerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

import {
  ADMIN_RESTORE_COOKIE,
  IMPERSONATION_COOKIE,
  IMPERSONATION_COOKIE_OPTIONS,
  parseAdminRestorePayload,
  parseImpersonationPayload,
} from "./impersonation-cookies.ts";
import { impersonationCookieSecret } from "./impersonation.ts";

/**
 * Puts the admin back into their own session and clears the impersonation state.
 *
 * Shared by the Stop button and by sign-out. Two rules hold everywhere in here:
 *
 * 1. **An impersonated browser must never reach a global sign-out.** `supabase.auth.signOut()`
 *    defaults to global scope, which would revoke the *learner's* sessions on their own devices.
 *    So whenever an impersonation is in progress this function always answers with a response —
 *    restored if it can, forcibly cleared if it cannot — and never returns null to let a caller
 *    fall through to sign-out.
 * 2. **Leaving revokes the session it minted.** The impersonation session is signed out through
 *    the admin API with `local` scope, which ends exactly that one session and leaves the
 *    learner's own devices untouched. Dropping the cookie without revoking would leave a live
 *    session for that account behind in anything that captured it.
 *
 * Returns null only when no impersonation is in progress, so ordinary sign-out is untouched.
 */
export async function restoreAdminSession(params: {
  request: NextRequest;
  redirectPath: string;
}): Promise<NextResponse | null> {
  const secret = impersonationCookieSecret();
  const impersonating = parseImpersonationPayload(
    params.request.cookies.get(IMPERSONATION_COOKIE)?.value,
    secret,
  );
  const restore = parseAdminRestorePayload(
    params.request.cookies.get(ADMIN_RESTORE_COOKIE)?.value,
    secret,
  );

  if (!impersonating && !restore) {
    return null;
  }

  await revokeImpersonatedSession(params.request);

  // The impersonation is in progress but its way back is gone (a dropped or tampered cookie).
  // Ending it locally is the only safe answer: leaving the browser signed in as the learner would
  // strand the admin there, and the sign-out that would follow is exactly the global revoke this
  // feature must never cause.
  if (!restore) {
    return clearEverything(params.request, "/admin/login");
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
  // must not strand them inside the learner's account.
  if (error) {
    console.warn("[admin-impersonation] Could not restore the admin session", {
      adminEmail: restore.adminEmail,
      error: error.message,
    });

    return clearEverything(params.request, "/admin/login");
  }

  const response = applyCookies(NextResponse.redirect(url, { status: 303 }));

  clearImpersonationCookies(response);

  console.warn("[admin-impersonation] Admin returned to their own account", {
    adminEmail: restore.adminEmail,
  });

  return response;
}

/**
 * Ends the impersonation session itself, scoped to this one session. Best-effort: failing to
 * revoke must not block the admin from getting out, and the cookies are dropped regardless.
 */
async function revokeImpersonatedSession(request: NextRequest) {
  const accessToken = readAccessTokenFromCookies(request);

  if (!accessToken) {
    return;
  }

  try {
    await createSupabaseServiceRoleClient().auth.admin.signOut(accessToken, "local");
  } catch (error) {
    console.warn("[admin-impersonation] Could not revoke the impersonation session", error);
  }
}

/**
 * Reads the access token out of the Supabase session cookie, including the chunked
 * (`…auth-token.0`, `.1`) form @supabase/ssr writes once the payload outgrows one cookie.
 */
function readAccessTokenFromCookies(request: NextRequest) {
  const chunks = request.cookies
    .getAll()
    .filter((cookie) => /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
    .map((cookie) => cookie.value);

  if (chunks.length === 0) {
    return null;
  }

  const raw = chunks.join("");
  const json = raw.startsWith("base64-")
    ? Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8")
    : raw;

  try {
    const parsed = JSON.parse(json) as { access_token?: unknown };

    return typeof parsed.access_token === "string" ? parsed.access_token : null;
  } catch {
    return null;
  }
}

/** Signs the browser out locally — every `sb-` cookie plus the impersonation state. */
function clearEverything(request: NextRequest, redirectPath: string) {
  const url = request.nextUrl.clone();
  url.pathname = redirectPath;
  url.search = "";

  const response = NextResponse.redirect(url, { status: 303 });

  request.cookies
    .getAll()
    .filter((cookie) => cookie.name.startsWith("sb-"))
    .forEach((cookie) => {
      response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
    });

  return clearImpersonationCookies(response);
}

export function clearImpersonationCookies(response: NextResponse) {
  for (const name of [ADMIN_RESTORE_COOKIE, IMPERSONATION_COOKIE]) {
    response.cookies.set(name, "", { ...IMPERSONATION_COOKIE_OPTIONS, maxAge: 0 });
  }

  return response;
}
