import { NextResponse, type NextRequest } from "next/server";

import { restoreAdminSession } from "@/lib/admin/impersonation-restore";

/**
 * Ends an impersonation session and returns the admin to their own account.
 *
 * Gated on the restore cookie rather than on `requireAdminApi`: while impersonating, the caller's
 * session *is* the learner's, so an admin check would refuse the very person who needs to get
 * out. The cookie is httpOnly and only ever written by the admin-gated start route, so it is
 * proof that this browser began an impersonation — and the endpoint is inert without it.
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
