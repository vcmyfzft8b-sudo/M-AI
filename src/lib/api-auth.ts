import "server-only";

import type { User } from "@supabase/supabase-js";

import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

/**
 * Authenticate both the cookie-based web app and first-party native clients.
 * Native clients send the same Supabase access token as a Bearer token, which
 * lets them call the exact feature route used by the web UI.
 */
export async function getApiUser(request: Request): Promise<User | null> {
  const browserClient = await createSupabaseServerClient();
  const {
    data: { user: browserUser },
  } = await browserClient.auth.getUser();

  if (browserUser) {
    return browserUser;
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();

  if (!bearer) {
    return null;
  }

  const {
    data: { user },
    error,
  } = await createSupabaseServiceRoleClient().auth.getUser(bearer);

  return error ? null : user;
}
