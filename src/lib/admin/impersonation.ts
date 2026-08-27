import "server-only";

import { createHash } from "node:crypto";

import { cookies } from "next/headers";

import { getServerEnv } from "@/lib/server-env";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

import {
  IMPERSONATION_COOKIE,
  parseImpersonationPayload,
  type ImpersonationPayload,
} from "./impersonation-cookies.ts";

export {
  ADMIN_RESTORE_COOKIE,
  IMPERSONATION_COOKIE,
  IMPERSONATION_COOKIE_OPTIONS,
  signCookiePayload,
  parseAdminRestorePayload,
  parseImpersonationPayload,
  type AdminRestorePayload,
  type ImpersonationPayload,
} from "./impersonation-cookies.ts";

/**
 * The key the impersonation cookies are signed with.
 *
 * Derived from the service-role key rather than a new env var: adding a required secret would
 * break the next deploy that forgot it, and this key already exists everywhere the feature runs,
 * never leaves the server, and is the same trust level as the thing it protects. It is hashed
 * with a label so the signing key is not the credential itself, and rotating the service-role key
 * simply invalidates outstanding impersonations — which is the correct outcome.
 */
export function impersonationCookieSecret() {
  return createHash("sha256")
    .update("memoai-impersonation-cookie-v1:")
    .update(getServerEnv().SUPABASE_SERVICE_ROLE_KEY)
    .digest();
}

/**
 * Admin impersonation: an admin holds a genuine session for another account so the app renders
 * exactly what that learner sees. A fabricated user object (the shape `PREVIEW_AUTH_BYPASS` uses)
 * would not do — pages resolve identity from the session but the API routes under
 * `src/app/api/lectures/**` authenticate independently, so a fake identity renders pages and 401s
 * every request behind them. A real session satisfies both, and no page, component or route needs
 * to know this feature exists.
 */

/** The target's email, for the audit row and the banner. Service-role: admins are not users. */
export async function resolveImpersonationTarget(userId: string) {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.auth.admin.getUserById(userId);

  if (error || !data?.user) {
    return null;
  }

  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Another admin's account is never a legitimate impersonation target: debugging a learner needs
 * a learner, while stepping into a colleague's admin account is lateral movement that the audit
 * row would attribute to them from that point on. Refused outright.
 */
export async function isAdminAccount(email: string) {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("admin_users")
    .select("email")
    .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
    .maybeSingle();

  // Fail closed: if the allowlist cannot be read, assume the target might be an admin.
  return Boolean(error) || Boolean(data);
}

/**
 * Mints a real session for the target.
 *
 * `generateLink` only *generates* — the SDK describes it as producing links "to be sent via a
 * custom email provider" — so the learner is never emailed by an admin opening their account.
 * That is verified against staging before this ships, because sending one would be a visible
 * intrusion into a real person's inbox.
 */
export async function mintImpersonationTokenHash(email: string) {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error) {
    throw new Error(error.message);
  }

  const hashedToken =
    (data as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token ?? null;

  if (!hashedToken) {
    throw new Error("Could not mint an impersonation session for this account.");
  }

  return hashedToken;
}

/**
 * One row per impersonation start. Fail-open: an audit write that cannot land must not strand an
 * admin mid-switch, and the structured log line below is a second, independent record.
 */
export async function recordImpersonationEvent(params: {
  adminEmail: string | null;
  targetUserId: string;
  targetEmail: string | null;
  userAgent: string | null;
}) {
  console.warn("[admin-impersonation] Admin opened a user account", {
    adminEmail: params.adminEmail,
    targetUserId: params.targetUserId,
  });

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase.from("admin_impersonation_events").insert({
      admin_email: params.adminEmail,
      target_user_id: params.targetUserId,
      target_email: params.targetEmail,
      user_agent: params.userAgent?.slice(0, 500) ?? null,
    } as never);

    if (error) {
      console.warn("Impersonation audit write failed.", error.message);
    }
  } catch (error) {
    console.warn("Impersonation audit write failed.", error);
  }
}

/** Server-side read for the banner. The cookie is httpOnly, so this is the only way to see it. */
export async function getImpersonationState(): Promise<ImpersonationPayload | null> {
  const cookieStore = await cookies();

  return parseImpersonationPayload(
    cookieStore.get(IMPERSONATION_COOKIE)?.value,
    impersonationCookieSecret(),
  );
}
