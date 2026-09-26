import "server-only";

import { STORAGE_BUCKET } from "@/lib/constants";
import { validateStoredAudioFile } from "@/lib/file-validation";
import { enqueueLectureProcessing, enqueueLectureScanProcessing } from "@/lib/jobs";
import { isRecord } from "@/lib/lecture-source-metadata";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Finishes an upload the phone started and never confirmed, from whatever reached storage.
 *
 * A note is created as `uploading`, the files go straight from the device to storage, and only
 * then does the device tell us to start. When the app is closed, the phone locks or the network
 * drops between those steps, the files can be sitting in storage while the note waits forever for
 * a call that will never come. In the week to 26 Sep 2026, 12 of 47 failed notes ended that way:
 * one learner tried seven times, and on one of the seven both photos had in fact arrived. The
 * sweep then failed them as "the upload never finished", and an audio note in the same state was
 * deleted outright as an empty draft, recording and all.
 *
 * So before anything is failed or discarded, we look in storage. Photos that arrived are read and
 * the note says how many did not; a recording that arrived is transcribed. Only a note with
 * nothing in storage is failed, and then the learner is told plainly to upload it again.
 */

/**
 * How long an `uploading` note must have been left alone before we finish it ourselves. The device
 * confirms within seconds of its last byte, so ten quiet minutes means it is not coming back; a
 * slow upload still in flight is protected by the conditional status write below either way.
 */
export const UPLOAD_SALVAGE_AFTER_MS = 10 * 60 * 1000;

export type UploadSalvageResult =
  | { outcome: "salvaged"; kind: "scan" | "audio"; arrived: number; expected: number }
  | { outcome: "nothing-arrived" }
  | { outcome: "not-applicable" };

type SalvageLecture = {
  id: string;
  user_id: string;
  status: string;
  source_type: string | null;
  storage_path: string | null;
  processing_metadata: unknown;
};

type PendingScanImage = { path: string } & Record<string, unknown>;

function readPendingScanImages(metadata: Record<string, unknown>): PendingScanImage[] {
  const value = metadata.pendingScanImages;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is PendingScanImage => isRecord(item) && typeof item.path === "string",
  );
}

async function listStoredObjectSizes(folder: string, search?: string) {
  const { data, error } = await createSupabaseServiceRoleClient()
    .storage.from(STORAGE_BUCKET)
    .list(folder, { limit: 100, ...(search ? { search } : {}) });

  if (error) {
    throw error;
  }

  const sizes = new Map<string, number>();

  for (const entry of data ?? []) {
    const size = Number((entry.metadata as { size?: unknown } | null)?.size ?? 0);
    sizes.set(`${folder}/${entry.name}`, Number.isFinite(size) ? size : 0);
  }

  return sizes;
}

async function salvageScan(lecture: SalvageLecture, metadata: Record<string, unknown>) {
  const images = readPendingScanImages(metadata);

  if (images.length === 0) {
    return null;
  }

  const stored = await listStoredObjectSizes(`${lecture.user_id}/${lecture.id}/scans`);
  const arrived = images.filter((image) => (stored.get(image.path) ?? 0) > 0);

  if (arrived.length === 0) {
    return { outcome: "nothing-arrived" } as const;
  }

  const nowIso = new Date().toISOString();
  // Conditional on the note still being `uploading`: if the device did come back and confirm in
  // the meantime, its own start wins and this is a no-op rather than a second paid run.
  const { data: claimed, error } = await createSupabaseServiceRoleClient()
    .from("lectures")
    .update(
      {
        status: "queued",
        error_message: null,
        processing_metadata: {
          ...metadata,
          pendingScanImages: arrived,
          uploadSalvage: {
            at: nowIso,
            expected: images.length,
            arrived: arrived.length,
            missing: images.length - arrived.length,
          },
          processing: { stage: "extracting_scan_text", updatedAt: nowIso, errorMessage: null },
        },
      } as never,
    )
    .eq("id", lecture.id)
    .eq("status", "uploading")
    .select("id");

  if (error) {
    throw error;
  }

  if (!claimed || claimed.length === 0) {
    return { outcome: "not-applicable" } as const;
  }

  await enqueueLectureScanProcessing(lecture.id);

  return {
    outcome: "salvaged",
    kind: "scan",
    arrived: arrived.length,
    expected: images.length,
  } as const;
}

async function salvageAudio(lecture: SalvageLecture, metadata: Record<string, unknown>) {
  if (lecture.source_type !== "audio") {
    return null;
  }

  // The recording is uploaded to `<user>/<lecture>.<ext>`, and the path is only written to the row
  // by the confirmation that never came, so it is found by name.
  const stored = await listStoredObjectSizes(lecture.user_id, lecture.id);
  const path = [...stored.entries()].find(
    ([objectPath, size]) =>
      size > 0 && objectPath.slice(lecture.user_id.length + 1).startsWith(`${lecture.id}.`),
  )?.[0];

  if (!path) {
    return { outcome: "nothing-arrived" } as const;
  }

  const validated = await validateStoredAudioFile({ path });

  if (!validated.ok) {
    // Half a file: it cannot be transcribed, and the learner is told to upload it again.
    return { outcome: "nothing-arrived" } as const;
  }

  const nowIso = new Date().toISOString();
  const { data: claimed, error } = await createSupabaseServiceRoleClient()
    .from("lectures")
    .update(
      {
        storage_path: path,
        status: "queued",
        error_message: null,
        processing_metadata: {
          ...metadata,
          uploadSalvage: { at: nowIso, expected: 1, arrived: 1, missing: 0 },
        },
      } as never,
    )
    .eq("id", lecture.id)
    .eq("status", "uploading")
    .select("id");

  if (error) {
    throw error;
  }

  if (!claimed || claimed.length === 0) {
    return { outcome: "not-applicable" } as const;
  }

  await enqueueLectureProcessing(lecture.id);

  return { outcome: "salvaged", kind: "audio", arrived: 1, expected: 1 } as const;
}

export async function salvageAbandonedUpload(lecture: SalvageLecture): Promise<UploadSalvageResult> {
  if (lecture.status !== "uploading") {
    return { outcome: "not-applicable" };
  }

  const metadata = isRecord(lecture.processing_metadata) ? lecture.processing_metadata : {};

  return (
    (await salvageScan(lecture, metadata)) ??
    (await salvageAudio(lecture, metadata)) ?? { outcome: "not-applicable" }
  );
}
