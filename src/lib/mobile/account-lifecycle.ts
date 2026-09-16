import type { User } from "@supabase/supabase-js";

export function accountDeletionRequested(user: Pick<User, "app_metadata">): boolean {
  return Boolean(user.app_metadata?.memo_deletion_requested_at);
}

export function isMissingAuthUser(error: { status?: number; code?: string } | null): boolean {
  return error?.status === 404 || error?.code === "user_not_found";
}
