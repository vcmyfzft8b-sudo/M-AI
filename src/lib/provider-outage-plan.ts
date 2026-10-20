// Imported by their real filenames so the Node test runner can load this module directly.
import { AI_PROVIDER_SPEND_CAP_FAILURE_CODE } from "./ai/errors.ts";
import { LECTURE_FAILURE_METADATA_KEY, readLectureFailureCode } from "./lecture-failure-codes.ts";
import { isRecord } from "./lecture-source-metadata.ts";
import { planResumeJob, type StallResumeJob } from "./lecture-stall-plan.ts";

/**
 * Which lectures the Gemini spend cap stopped, and how each is finished once Gemini answers again.
 *
 * The decision half, kept pure so it can be tested without a database; the hourly stall sweep
 * (`recoverFromProviderOutage` in lecture-stall-sweep.ts) runs it. On 2026-10-20 the 17 lectures the cap had failed were
 * re-queued by hand with the retry route's logic. This is that, done by the sweep:
 *
 *  1. Only lectures recorded with the spend-cap code. Anything else failed for a reason a second
 *     run would not fix by itself, and keeps its retry button for the learner instead.
 *  2. One automatic retry per lecture, ever, stamped on the row before the job is enqueued — the
 *     same rule, for the same reason, as the stall sweep's resume: a lecture that the cap stops
 *     again (it was raised by too little, or reached again) waits for the learner or a person
 *     rather than being billed in a loop.
 *  3. From the cheapest point that still exists: `planResumeJob`, which the stall sweep uses too.
 *     It agrees with POST /api/lectures/[id]/retry on every shape the cap leaves behind — photos
 *     still to read run the scan job, a document still to read runs the document job, prepared
 *     text runs note generation, a recording runs transcription — except that a recording whose
 *     transcript is already stored goes straight to its notes, rather than paying to transcribe
 *     it again.
 */

/** Where the retry is recorded on the row, so the next sweep can see it happened. */
export const PROVIDER_OUTAGE_RETRY_METADATA_KEY = "providerOutageRetry";

export type ProviderOutageRetryPlan =
  | { action: "retry"; job: StallResumeJob }
  | { action: "skip"; reason: "not-failed" | "not-spend-cap" | "already-retried" | "no-source" };

export type ProviderOutageRetryInput = {
  status: string;
  processingMetadata: unknown;
  sourceType: string | null;
  storagePath: string | null;
  hasTranscript: boolean;
};

/** When the sweep retried this lecture after an outage, or null if it never has. */
export function readProviderOutageRetryAt(processingMetadata: unknown) {
  if (!isRecord(processingMetadata)) {
    return null;
  }

  const mark = processingMetadata[PROVIDER_OUTAGE_RETRY_METADATA_KEY];

  return isRecord(mark) && typeof mark.at === "string" ? mark.at : null;
}

export function planProviderOutageRetry(input: ProviderOutageRetryInput): ProviderOutageRetryPlan {
  if (input.status !== "failed") {
    return { action: "skip", reason: "not-failed" };
  }

  if (readLectureFailureCode(input.processingMetadata) !== AI_PROVIDER_SPEND_CAP_FAILURE_CODE) {
    return { action: "skip", reason: "not-spend-cap" };
  }

  if (readProviderOutageRetryAt(input.processingMetadata)) {
    return { action: "skip", reason: "already-retried" };
  }

  const job = planResumeJob(input);

  return job ? { action: "retry", job } : { action: "skip", reason: "no-source" };
}

/**
 * The row as it is written just before the retry is enqueued: back in the queue with its error
 * cleared — what the learner's own retry button writes — and stamped as retried.
 *
 * The failure code is cleared with it. Left in place, the note screen would keep resolving it into
 * the spend-cap sentence over a lecture that is processing again.
 */
export function withProviderOutageRetryMark(processingMetadata: unknown, nowIso: string) {
  const metadata = isRecord(processingMetadata) ? processingMetadata : {};
  const processing = isRecord(metadata.processing) ? metadata.processing : {};

  return {
    ...metadata,
    [PROVIDER_OUTAGE_RETRY_METADATA_KEY]: { at: nowIso },
    [LECTURE_FAILURE_METADATA_KEY]: { code: null },
    processing: { ...processing, stage: "queued", updatedAt: nowIso, errorMessage: null },
  };
}
