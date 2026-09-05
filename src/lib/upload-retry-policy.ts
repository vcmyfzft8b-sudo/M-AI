/**
 * When an upload that just failed is worth trying again, and how long to wait before doing it.
 *
 * Kept apart from the upload itself — and free of every app import — so the policy can be tested
 * without a browser, a bucket or a network. `signed-upload-client.ts` supplies the attempt; this
 * decides whether there is another one.
 *
 * The policy exists because until 2026-09-05 there wasn't one. Every upload in the app was a
 * single attempt, and in the three weeks to that date seven learners lost photographed notes to
 * it — five of them had picked seven to ten pages, 15 to 43 MB, sent one file at a time, where a
 * single dropped PUT anywhere in the sequence threw the whole set away.
 */

/** Total attempts per file, including the first. */
export const DEFAULT_UPLOAD_ATTEMPTS = 3;

/** Waits between attempts. One short, one long enough to outlive a lift or a tunnel. */
export const RETRY_DELAYS_MS = [600, 2_400];

export class SignedUploadError extends Error {
  /** The HTTP status the storage API answered with, when it answered at all. */
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "SignedUploadError";
    this.status = status;
  }
}

export function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error as { name?: string } | null)?.name === "AbortError"
  );
}

export function abortError() {
  return new DOMException("Upload was aborted.", "AbortError");
}

/**
 * Whether trying the same bytes again could plausibly work.
 *
 * The message test is the one that matters in practice: a phone that loses its connection
 * mid-PUT surfaces as "Load failed" on iOS Safari and "Failed to fetch" on Chrome, with no
 * status at all. Where there is a status, only the ones that mean "not now" are retried — a 400
 * or a 403 is a verdict on the request, and it will be the same verdict next time. Retrying one
 * would make the learner watch the same rejection three times before hearing about it.
 */
export function isRetryableUploadFailure(error: unknown) {
  if (isAbortError(error)) {
    return false;
  }

  const status = error instanceof SignedUploadError ? error.status : null;

  if (status != null) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  const raw = error as { name?: string; message?: string } | null;
  const text = `${raw?.name ?? ""} ${raw?.message ?? ""}`.toLowerCase();

  return (
    text.includes("load failed") ||
    text.includes("failed to fetch") ||
    text.includes("network") ||
    text.includes("timeout") ||
    text.includes("timed out")
  );
}

export function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timeoutId);
      reject(abortError());
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs `attempt` until it succeeds, gives up, or is abandoned.
 *
 * `onRetry` is how a caller tells the learner what is happening. A silent retry looks exactly
 * like a stall, and the wait before the last attempt is long enough to be noticed.
 */
export async function runWithUploadRetries(params: {
  attempt: () => Promise<void>;
  attempts?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, attempts: number) => void;
  /** Injected by the tests; real callers get the timer. */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}) {
  const attempts = Math.max(1, params.attempts ?? DEFAULT_UPLOAD_ATTEMPTS);
  const wait = params.wait ?? delay;

  for (let attempt = 1; ; attempt += 1) {
    if (params.signal?.aborted) {
      throw abortError();
    }

    try {
      await params.attempt();
      return;
    } catch (error) {
      // An abandoned upload is not a failed one: the learner has already moved on, and retrying
      // would keep pushing bytes at a note they cancelled.
      if (isAbortError(error) || params.signal?.aborted) {
        throw error;
      }

      if (attempt >= attempts || !isRetryableUploadFailure(error)) {
        throw error;
      }

      params.onRetry?.(attempt + 1, attempts);
      await wait(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)], params.signal);
    }
  }
}
