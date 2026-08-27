import { NextResponse, type NextRequest } from "next/server";

import { restoreAdminSession } from "@/lib/admin/impersonation-restore";

/**
 * Ends an impersonation session and returns the admin to their own account.
 *
 * Gated on the signed impersonation cookies rather than on `requireAdminApi`: while impersonating,
 * the caller's session *is* the learner's, so an admin check would refuse the very person who
 * needs to get out. The cookies are httpOnly and HMAC-signed with a server key, so only the
 * admin-gated start route can have produced them — and the endpoint is inert without them.
 *
 * `restoreAdminSession` always answers when an impersonation is in progress (restoring, or
 * forcibly clearing when the way back is gone), so reaching the fallback below means there was
 * nothing to stop.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const restored = await restoreAdminSession({ request, redirectPath: "/admin/users" });

  if (restored) {
    return restored;
  }

  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";

  return NextResponse.redirect(url, { status: 303 });
}
