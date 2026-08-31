import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Whether an account has opened the "add to home screen" guide.
 *
 * The badge on the settings gear and on the row it points at is meant to be
 * seen once, by everybody, and then never again — so the fact has to outlive
 * the browser it was answered in. It lives on the profile
 * (`install_guide_seen_at`, migration 0038) rather than in `localStorage`,
 * which was per-browser: the badge came back on the second device and
 * disappeared for anyone who cleared their storage.
 *
 * Reading it needs nothing from here — the screens that draw the badge already
 * load the profile for other reasons, and `install_guide_seen_at` being null is
 * the whole of "still owed the guide". Only the write lives here.
 */

/**
 * True when a failure is the database not having migration 0038's column.
 *
 * Postgres answers 42703 for an unknown column and PostgREST answers PGRST204
 * when its schema cache has never seen one. Either way the badge has no
 * storage behind it yet, which is a deployment state rather than a fault in
 * the request — a red dot is not worth a 500.
 */
function isMissingInstallGuideSchema(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    Boolean(error.message?.includes("install_guide_seen_at"))
  );
}

/**
 * Records that the guide was opened. Idempotent: the first instant is the one
 * that matters, and a second open would only move a timestamp nothing reads.
 */
export async function markInstallGuideSeenForUser(userId: string): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();

  const { error } = await supabase
    .from("profiles")
    .update({ install_guide_seen_at: new Date().toISOString() } as never)
    .eq("id", userId)
    .is("install_guide_seen_at", null);

  if (error && !isMissingInstallGuideSchema(error)) {
    throw error;
  }
}
