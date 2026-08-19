import "server-only";

import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getOptionalUser } from "@/lib/auth";
import type { AdminRole, AdminUserRow } from "@/lib/database.types";
import { insertInto, updateIn } from "@/lib/admin/db";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export type AdminContext = {
  user: User;
  admin: AdminUserRow;
  isOwner: boolean;
};

export type AdminDenialReason = "unauthenticated" | "not_allowlisted";

export function normalizeAdminEmail(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Resolves the signed-in user and checks their email against `admin_users`.
 *
 * This deliberately calls `getOptionalUser` rather than
 * `getOptionalUserOrPreviewBypass`: `PREVIEW_AUTH_BYPASS` fabricates a session
 * for Preview deployments, and that must never be a route into the admin
 * dashboard, which reads live Stripe revenue and the full user list.
 */
export const getAdminContext = cache(async function getAdminContext(): Promise<
  { ok: true; context: AdminContext } | { ok: false; reason: AdminDenialReason; email: string | null }
> {
  const user = await getOptionalUser();

  if (!user) {
    return { ok: false, reason: "unauthenticated", email: null };
  }

  const email = typeof user.email === "string" ? normalizeAdminEmail(user.email) : "";

  if (!email) {
    return { ok: false, reason: "not_allowlisted", email: null };
  }

  // A Supabase session is only proof of the email when the address is
  // confirmed. Both the OTP and the Google flows confirm on sign-in, but an
  // unconfirmed address must not be able to claim an allowlisted one.
  const emailConfirmed = Boolean(user.email_confirmed_at ?? user.confirmed_at);

  if (!emailConfirmed) {
    return { ok: false, reason: "not_allowlisted", email };
  }

  const serviceRole = createSupabaseServiceRoleClient();
  const { data, error } = await serviceRole
    .from("admin_users")
    .select("*")
    .ilike("email", email)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, reason: "not_allowlisted", email };
  }

  const admin = data as AdminUserRow;

  return {
    ok: true,
    context: {
      user,
      admin,
      isOwner: admin.role === "owner",
    },
  };
});

/** Server-component guard. Sends anyone who is not an admin to the login page. */
export async function requireAdmin(): Promise<AdminContext> {
  const result = await getAdminContext();

  if (!result.ok) {
    redirect(
      result.reason === "unauthenticated"
        ? "/admin/login"
        : "/admin/login?denied=1",
    );
  }

  return result.context;
}

/** Route-handler guard. Returns a `Response` to send back when access is denied. */
export async function requireAdminApi(): Promise<
  { ok: true; context: AdminContext } | { ok: false; response: Response }
> {
  const result = await getAdminContext();

  if (result.ok) {
    return { ok: true, context: result.context };
  }

  return {
    ok: false,
    response: Response.json(
      {
        error:
          result.reason === "unauthenticated"
            ? "Sign in to use the admin API."
            : "This account is not allowed to use the admin API.",
      },
      { status: result.reason === "unauthenticated" ? 401 : 403 },
    ),
  };
}

export async function requireAdminOwner(): Promise<AdminContext> {
  const context = await requireAdmin();

  if (!context.isOwner) {
    redirect("/admin?error=owner_only");
  }

  return context;
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const serviceRole = createSupabaseServiceRoleClient();
  const { data, error } = await serviceRole
    .from("admin_users")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Could not load the admin allowlist: ${error.message}`);
  }

  return (data ?? []) as AdminUserRow[];
}

export async function addAdminUser(options: {
  email: string;
  label?: string | null;
  role?: AdminRole;
  createdBy: string;
}) {
  const serviceRole = createSupabaseServiceRoleClient();
  const email = normalizeAdminEmail(options.email);

  const { error } = await insertInto(serviceRole, "admin_users", {
    email,
    label: options.label?.trim() || null,
    // Only the seeded owner holds the `owner` role; everyone added through the
    // dashboard is a plain admin and can therefore be removed again.
    role: options.role === "owner" ? "admin" : (options.role ?? "admin"),
    created_by: options.createdBy,
  });

  if (error) {
    throw new Error(
      error.code === "23505"
        ? "That email already has admin access."
        : `Could not add the admin: ${error.message}`,
    );
  }
}

export async function removeAdminUser(id: string) {
  const serviceRole = createSupabaseServiceRoleClient();

  const { data: target, error: readError } = await serviceRole
    .from("admin_users")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    throw new Error(`Could not look up that admin: ${readError.message}`);
  }

  if (!target) {
    throw new Error("That admin no longer exists.");
  }

  // Guarding the owner row is what stops the dashboard from being locked out.
  if ((target as AdminUserRow).role === "owner") {
    throw new Error("The owner account cannot be removed.");
  }

  const { error } = await serviceRole.from("admin_users").delete().eq("id", id);

  if (error) {
    throw new Error(`Could not remove that admin: ${error.message}`);
  }
}

export async function touchAdminLastSeen(id: string) {
  const serviceRole = createSupabaseServiceRoleClient();

  await updateIn(serviceRole, "admin_users", {
    last_seen_at: new Date().toISOString(),
  }).eq("id", id);
}
