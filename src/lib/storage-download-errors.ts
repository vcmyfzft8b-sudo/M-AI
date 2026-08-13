function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const TRANSIENT_MESSAGE_FRAGMENTS = [
  "bad gateway",
  "connection",
  "econnreset",
  "fetch failed",
  "gateway",
  "network",
  "service unavailable",
  "timeout",
  "temporarily",
  "upstream",
];

// Supabase Storage answers a read that lands before the object row is visible with a
// missing-object body. StorageApiError carries the HTTP status on `status` (400 on older
// storage-api, 404 on newer) and the body's own code on `statusCode`, so match the message
// rather than the status alone: a missing bucket or a bad path share the same status.
const MISSING_OBJECT_MESSAGE_FRAGMENTS = ["object not found", "the resource was not found"];

function getStorageDownloadErrorMessage(error: unknown) {
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return null;
}

function getStorageDownloadStatus(error: unknown) {
  if (!isRecord(error)) {
    return null;
  }

  const status = error.status ?? error.statusCode;

  if (typeof status === "number") {
    return status;
  }

  if (typeof status === "string") {
    const parsedStatus = Number.parseInt(status, 10);
    return Number.isFinite(parsedStatus) ? parsedStatus : null;
  }

  return null;
}

export function isTransientStorageDownloadError(error: unknown) {
  const status = getStorageDownloadStatus(error);
  const message = getStorageDownloadErrorMessage(error)?.trim().toLowerCase() ?? "";

  if (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    (status != null && status >= 500)
  ) {
    return true;
  }

  // Retry only the read-after-write miss. Every other client error still fails on the
  // first response, including a missing bucket, which shares the same status.
  if (
    (status === 400 || status === 404) &&
    MISSING_OBJECT_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment))
  ) {
    return true;
  }

  // A status the storage service chose is authoritative; only fall back to matching the
  // message when the failure never reached the service (fetch/DNS/socket errors).
  if (status != null) {
    return false;
  }

  return TRANSIENT_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));
}
