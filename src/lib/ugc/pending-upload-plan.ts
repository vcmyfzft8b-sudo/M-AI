/**
 * Which sample-video uploads the cleanup may delete. Pure, so the rule is tested on its own;
 * the storage work around it is `pending-upload-sweep.ts`.
 *
 * An applicant uploads their video before sending the form (`/api/ugc/applications/video`
 * hands out a signed upload for `pending/<uuid>.<ext>`), so a form that is abandoned, or
 * refused as a duplicate, leaves a file nothing points at. Those are what goes: an object
 * under `pending/` that no application references and that is old enough that nobody can
 * still be filling in the form it belongs to. A referenced upload is never deleted,
 * however old: it is the video the admin reviews.
 */

/** Long past any form still being filled in; a later submit just asks for a new upload. */
export const PENDING_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type PendingUpload = {
  /** Full path in the bucket, `pending/<uuid>.<ext>`. */
  path: string;
  /** When the upload was created; `null` when storage did not say, which never qualifies. */
  createdAt: string | null;
};

/** The uploads old enough to be considered at all. */
export function uploadsOlderThan(uploads: PendingUpload[], now: Date, maxAgeMs = PENDING_UPLOAD_MAX_AGE_MS): PendingUpload[] {
  const cutoff = now.getTime() - maxAgeMs;

  return uploads.filter((upload) => {
    const created = upload.createdAt ? Date.parse(upload.createdAt) : Number.NaN;

    return Number.isFinite(created) && created < cutoff;
  });
}

/** Of the old enough uploads, the ones no application points at. */
export function orphanedUploads(candidates: PendingUpload[], referenced: ReadonlySet<string>): string[] {
  return candidates.map((upload) => upload.path).filter((path) => path.startsWith("pending/") && !referenced.has(path));
}
