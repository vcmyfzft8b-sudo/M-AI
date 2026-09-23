import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { removeStoragePrefix } from "./storage-cleanup.ts";
import { isMissingAuthUser } from "./account-lifecycle.ts";

import { STORAGE_BUCKET } from "../constants.ts";

/**
 * Retryable after a timeout or partial failure. The durable prefix inventory is
 * saved before auth deletion can cascade/SET NULL the original owner records.
 * Never process a request before its signed-upload drain period has elapsed.
 */
export async function eraseDueAccountsWith(
  service: SupabaseClient<Database>,
  cancelWebBilling: (customerId: string) => Promise<void>,
  now = new Date(),
  revokeAppleAuthorization: (userId: string) => Promise<void> = async () => {},
) {
  const { data: jobs, error } = await service.from("account_deletion_requests")
    .select("*").lte("cleanup_after", now.toISOString()).order("cleanup_after").limit(5);
  if (error) throw error;
  const outcome = { deleted: 0, failed: 0 };
  for (const job of (jobs ?? []) as Database["public"]["Tables"]["account_deletion_requests"]["Row"][]) {
    try {
      const ids = new Set(job.failure_lecture_ids);
      // An older request may have created a lecture just after deletion was
      // requested. By now all such requests have drained; include their IDs.
      for (let offset = 0; ; offset += 500) {
        const result = await service.from("lectures").select("id").eq("user_id", job.user_id)
          .order("id").range(offset, offset + 499);
        if (result.error) throw result.error;
        for (const row of (result.data ?? []) as { id: string }[]) ids.add(row.id);
        if ((result.data?.length ?? 0) < 500) break;
      }
      for (let offset = 0; ; offset += 500) {
        const result = await service.from("generation_failure_captures").select("lecture_id").eq("user_id", job.user_id)
          .order("lecture_id").range(offset, offset + 499);
        if (result.error) throw result.error;
        for (const row of (result.data ?? []) as { lecture_id: string }[]) ids.add(row.lecture_id);
        if ((result.data?.length ?? 0) < 500) break;
      }
      const inventory = await service.from("account_deletion_requests")
        .update({ failure_lecture_ids: [...ids] } as never).eq("user_id", job.user_id);
      if (inventory.error) throw inventory.error;

      const storage = service.storage.from(STORAGE_BUCKET);
      for (const prefix of [job.user_id, `tts/${job.user_id}`, `podcast/${job.user_id}`]) {
        await removeStoragePrefix(storage, prefix);
      }
      for (const id of ids) await removeStoragePrefix(storage, `failure-captures/${id}`);
      const captures = await service.from("generation_failure_captures").delete().eq("user_id", job.user_id);
      if (captures.error) throw captures.error;
      const usage = await service.from("ai_usage_events").delete().eq("user_id", job.user_id);
      if (usage.error) throw usage.error;
      // These tables use ON DELETE SET NULL. Remove the owned activity before
      // deleting Auth, while its owner is still available for scoped cleanup.
      // Deleting a session also cascades its signed-out page views.
      const views = await service.from("site_page_views").delete().eq("user_id", job.user_id);
      if (views.error) throw views.error;
      const sessions = await service.from("site_sessions").delete().eq("user_id", job.user_id);
      if (sessions.error) throw sessions.error;
      // A checkout that began just before the deletion request may finish after
      // the first cancellation pass. Reconcile once more after the drain.
      const profileResult = await service.from("profiles").select("stripe_customer_id").eq("id", job.user_id).maybeSingle();
      if (profileResult.error) throw profileResult.error;
      const profile = profileResult.data as { stripe_customer_id: string | null } | null;
      if (profile?.stripe_customer_id) {
        await cancelWebBilling(profile.stripe_customer_id);
      }
      await revokeAppleAuthorization(job.user_id);
      const deleted = await service.auth.admin.deleteUser(job.user_id);
      if (deleted.error && !isMissingAuthUser(deleted.error)) throw deleted.error;
      const completed = await service.from("account_deletion_requests").delete().eq("user_id", job.user_id);
      if (completed.error) throw completed.error;
      outcome.deleted += 1;
    } catch {
      // Do not put user IDs or source content in cron logs. Retain the durable
      // job for the next scheduled attempt and report that intervention may be needed.
      outcome.failed += 1;
    }
  }
  return outcome;
}
