import { NextRequest, NextResponse } from "next/server";

import { restoreAdminSession } from "@/lib/admin/impersonation-restore";
import { PREVIEW_AUTH_BYPASS_DISABLED_COOKIE } from "@/lib/preview-mode";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit({
    request,
    route: "auth:logout:post",
    rules: rateLimitPresets.authLogout,
  });

  if (limited) {
    return limited;
  }

  // An admin inside someone else's account holds that learner's session, and `signOut()` defaults
  // to global scope — signing out here would revoke the learner's sessions on their own devices.
  // Logging out of an impersonated account means leaving it, so it restores the admin instead.
  const restored = await restoreAdminSession({ request, redirectPath: "/admin/users" });

  if (restored) {
    return restored;
  }

  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";

  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  await supabase.auth.signOut();

  const response = applyCookies(
    NextResponse.redirect(url, {
      status: 303,
    }),
  );

  request.cookies
    .getAll()
    .filter((cookie) => cookie.name.startsWith("sb-"))
    .forEach((cookie) => {
      response.cookies.set(cookie.name, "", {
        path: "/",
        maxAge: 0,
      });
    });

  response.cookies.set(PREVIEW_AUTH_BYPASS_DISABLED_COOKIE, "true", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}
