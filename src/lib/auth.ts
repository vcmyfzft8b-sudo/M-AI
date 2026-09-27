import "server-only";

import type { User } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { isPreviewAuthBypassEnabled } from "@/lib/preview-mode";
import { createSupabaseServerClient, getRouteUser } from "@/lib/supabase/server";
import {
  parseVerifiedPageUser,
  VERIFIED_PAGE_USER_HEADER,
} from "@/lib/verified-page-user";

export const getOptionalUser = cache(async function getOptionalUser() {
  const verifiedPageUser = parseVerifiedPageUser(
    (await headers()).get(VERIFIED_PAGE_USER_HEADER),
  );

  if (verifiedPageUser) {
    return verifiedPageUser;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
});

/**
 * The stand-in account the preview bypass signs in as. Exported so entitlement
 * can recognise it: it has no profile row, and without one every page would
 * bounce it into onboarding.
 */
export const PREVIEW_AUTH_BYPASS_USER_ID = "00000000-0000-4000-8000-000000000001";

function getPreviewAuthBypassUser() {
  return {
    id: PREVIEW_AUTH_BYPASS_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "preview@memo.app",
    app_metadata: {
      provider: "preview",
      providers: ["preview"],
    },
    user_metadata: {
      name: "Preview User",
    },
    identities: [],
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    is_anonymous: false,
  } as User;
}

export const getOptionalUserOrPreviewBypass = cache(async function getOptionalUserOrPreviewBypass() {
  const user = await getOptionalUser();

  if (user) {
    return user;
  }

  if (await isPreviewAuthBypassEnabled()) {
    return getPreviewAuthBypassUser();
  }

  return null;
});

/**
 * `getRouteUser` for an API route that also lets the preview bypass in, keeping the client
 * that verified the learner. Queries that must run as the learner belong on that client: a
 * second one built from the same expired cookie refreshes again, and if Auth refuses that
 * refresh it asks as anon, so RLS reads the learner's own note as missing.
 */
export async function getRouteUserOrPreviewBypass(context: { route: string; request: Request }) {
  const auth = await getRouteUser(context);

  if (auth.user || auth.response.status !== 401 || !(await isPreviewAuthBypassEnabled())) {
    return auth;
  }

  return { supabase: null, user: getPreviewAuthBypassUser(), response: null };
}

export const requireUser = cache(async function requireUser() {
  const user = await getOptionalUserOrPreviewBypass();

  if (!user) {
    redirect("/");
  }

  return user;
});
