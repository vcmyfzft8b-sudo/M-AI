import "server-only";

import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";

import { isPreviewAuthBypassEnabled } from "@/lib/preview-mode";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const getOptionalUser = cache(async function getOptionalUser() {
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

export const requireUser = cache(async function requireUser() {
  const user = await getOptionalUserOrPreviewBypass();

  if (!user) {
    redirect("/");
  }

  return user;
});
