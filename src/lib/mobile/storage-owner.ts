import "server-only";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { accountDeletionRequested } from "./account-lifecycle";

/** Called immediately before a service-role upload/copy, including every retry. */
export async function assertStorageOwnerActive(userId: string) {
  const { data, error } = await createSupabaseServiceRoleClient().auth.admin.getUserById(userId);
  if (error || !data.user || accountDeletionRequested(data.user)) {
    throw new Error("Storage owner is unavailable or account deletion has been requested.");
  }
}
