import "server-only";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { accountDeletionRequested } from "./account-lifecycle";

/**
 * Called immediately before a service-role upload/copy, including every retry.
 *
 * Only a confirmed answer blocks the write: an account that asked for deletion,
 * or one that no longer exists. A failed lookup (network, rate limit) lets the
 * write proceed as it always did — the storage policy and the three-hour drain
 * still stand between a deleting account and its data.
 */
export async function assertStorageOwnerActive(userId: string) {
  let lookup: Awaited<ReturnType<ReturnType<typeof createSupabaseServiceRoleClient>["auth"]["admin"]["getUserById"]>>;
  try {
    lookup = await createSupabaseServiceRoleClient().auth.admin.getUserById(userId);
  } catch {
    return;
  }
  if (lookup.error) return;
  if (!lookup.data.user || accountDeletionRequested(lookup.data.user)) {
    throw new Error("Storage owner is unavailable or account deletion has been requested.");
  }
}
