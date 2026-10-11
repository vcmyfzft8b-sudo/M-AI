import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { APPLICATION_VIDEO_BUCKET } from "@/lib/ugc/creator-application";
import { orphanedUploads, uploadsOlderThan, type PendingUpload } from "@/lib/ugc/pending-upload-plan";

/**
 * Deletes sample-video uploads no application uses (the rule: `pending-upload-plan.ts`).
 * Run daily by `/api/cron/ugc-pending-uploads`.
 */

/** Storage lists at most this many objects per call; the folder is read page by page. */
const LIST_PAGE = 1000;
/** Paths per `in (...)` lookup and per delete call, to keep each request small. */
const CHUNK = 100;

export type PendingUploadSweepOutcome = {
  scanned: number;
  oldEnough: number;
  referenced: number;
  deleted: number;
  errors: string[];
};

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

export async function sweepPendingUploads({ now = new Date() }: { now?: Date } = {}): Promise<PendingUploadSweepOutcome> {
  const supabase = createSupabaseServiceRoleClient();
  const bucket = supabase.storage.from(APPLICATION_VIDEO_BUCKET);
  const uploads: PendingUpload[] = [];

  // Oldest first, so a page boundary moving while we read can only hide new uploads.
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await bucket.list("pending", {
      limit: LIST_PAGE,
      offset,
      sortBy: { column: "created_at", order: "asc" },
    });

    if (error) {
      throw new Error(`Could not list pending uploads: ${error.message}`);
    }

    // Folders come back with no id; there are none under pending/, but never treat one as a file.
    for (const object of data ?? []) {
      if (object.id) {
        uploads.push({ path: `pending/${object.name}`, createdAt: object.created_at ?? null });
      }
    }

    if (!data || data.length < LIST_PAGE) {
      break;
    }
  }

  const candidates = uploadsOlderThan(uploads, now);
  const referenced = new Set<string>();

  for (const paths of chunks(candidates.map((upload) => upload.path), CHUNK)) {
    const { data, error } = await supabase
      .from("ugc_creator_applications")
      .select("sample_video_path")
      .in("sample_video_path", paths);

    // Without knowing which are referenced nothing may go: a wrong guess deletes the video
    // an applicant is waiting on.
    if (error) {
      throw new Error(`Could not check which uploads are in use: ${error.message}`);
    }

    for (const row of (data ?? []) as Array<{ sample_video_path: string | null }>) {
      if (row.sample_video_path) {
        referenced.add(row.sample_video_path);
      }
    }
  }

  const orphans = orphanedUploads(candidates, referenced);
  const errors: string[] = [];
  let deleted = 0;

  for (const paths of chunks(orphans, CHUNK)) {
    const { data, error } = await bucket.remove(paths);

    if (error) {
      errors.push(error.message);
    } else {
      deleted += data?.length ?? 0;
    }
  }

  return { scanned: uploads.length, oldEnough: candidates.length, referenced: referenced.size, deleted, errors };
}
