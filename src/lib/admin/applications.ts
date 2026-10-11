import "server-only";

import { cache } from "react";

import { loadEveryRow } from "@/lib/admin/paged-rows";
import type { UgcApplicationStatus, UgcCreatorApplicationRow } from "@/lib/database.types";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Reads behind `/admin/applications`: who applied to the creator program from `/ugc`.
 * Service role only, after the allowlist check in the page and the layout.
 */

export const APPLICATION_STATUSES: UgcApplicationStatus[] = ["new", "approved", "rejected"];

export function isApplicationStatus(value: unknown): value is UgcApplicationStatus {
  return typeof value === "string" && (APPLICATION_STATUSES as string[]).includes(value);
}

/** Every application, newest first. Paged, so the list never stops silently at 1,000. */
export async function listApplications(): Promise<UgcCreatorApplicationRow[]> {
  const serviceRole = createSupabaseServiceRoleClient();

  return loadEveryRow<UgcCreatorApplicationRow>((from, to) =>
    serviceRole
      .from("ugc_creator_applications")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
      .then(({ data, error }) => ({ data: data as UgcCreatorApplicationRow[] | null, error })),
  );
}

/** Counted once per request: the nav badge reads it on every admin page. */
export const countNewApplications = cache(async (): Promise<number> => {
  const serviceRole = createSupabaseServiceRoleClient();
  const { count } = await serviceRole
    .from("ugc_creator_applications")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");

  return count ?? 0;
});
