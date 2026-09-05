// Imported by their real filenames so the Node test runner can load this module directly.
import { parseAudioChunkManifest } from "./audio-processing.ts";
import { isRecord } from "./lecture-source-metadata.ts";

/**
 * What to do about a lecture that is still mid-pipeline long after any run could still be alive.
 *
 * Recovery used to happen in one place only: the lecture GET handler, which re-enqueues a stale
 * run when somebody opens the note. That heals the lectures a learner comes back to and nothing
 * else — a lecture nobody reopens sits in `generating_notes` forever, showing a spinner that will
 * never resolve. Over the 30 days to 2026-09-05 that left 18 such rows, the oldest three weeks
 * old, none of which can settle on their own.
 *
 * This module is the decision half of the sweep that fixes that, kept pure so the policy can be
 * tested without a database. `lecture-stall-sweep.ts` executes it.
 *
 * The policy is written around cost, because the sweep spends money the learner did not ask it
 * to. Three rules keep that bounded:
 *
 *  1. Never resume a run that might still be alive. The bar is 60 minutes without the pipeline
 *     touching `processing.updatedAt` — the same bar the GET handler already trusts when it
 *     declares an unrecoverable run dead.
 *  2. Resume from the cheapest point that still exists. A lecture whose transcript is already
 *     written resumes at note generation, not at transcription, even when the source metadata
 *     that produced the transcript is still on the row.
 *  3. One paid resume per lecture, ever. A lecture that stalls again after being swept is failed
 *     rather than resumed a second time, so a lecture that stalls reproducibly cannot bill us in
 *     a loop. Failing costs nothing.
 */

/** The non-terminal statuses. 'ready' and 'failed' are the only two that settle. */
export const STALLED_LECTURE_STATUSES = [
  "uploading",
  "queued",
  "transcribing",
  "generating_notes",
] as const;

/**
 * How long a lecture may sit with no stage movement before a sweep treats the run as dead.
 *
 * Deliberately far longer than the GET handler's 6-minute resume: a reader who opens a note is
 * telling us they are waiting for it, and a duplicate run started under a watching learner is
 * cheap insurance. A sweep has no such signal, so it waits until a live run is implausible.
 * Resuming a run that is merely slow would pay for the same stages twice.
 */
export const STALL_RESUME_AFTER_MS = 60 * 60 * 1000;

/**
 * One paid resume per lecture. The second stall is a lecture that cannot finish, not a lecture
 * that was unlucky, and paying to prove that twice buys nothing.
 */
export const MAX_SWEEP_RESUMES = 1;

/** Where the sweep records what it has already spent on a lecture. */
export const STALL_SWEEP_METADATA_KEY = "stallSweep";

/**
 * The statuses a server-side run actually owns.
 *
 * `uploading` is deliberately absent, and it is the one that matters: it means the browser was
 * still handing us the file, so there is no dead run to resume — the run never started. A scan
 * lecture is the trap. `pendingScanImages` is written when the signed upload URLs are *issued*
 * (see the scan-uploads route), not when the bytes land, so a lecture abandoned mid-upload looks
 * fully resumable while its storage paths point at nothing. Resuming one buys an OCR bill for
 * files that were never uploaded. Every one of the 14 lectures stuck in production on 2026-09-05
 * was in this state.
 */
const RESUMABLE_STATUSES = new Set(["queued", "transcribing", "generating_notes"]);

export type StallResumeJob = "notes" | "scan" | "document" | "link" | "audio";

export type StallPlan =
  | { action: "wait"; reason: "recent" | "settled" }
  | { action: "resume"; job: StallResumeJob }
  | { action: "discard"; reason: "never-started" }
  | { action: "fail"; reason: "no-source" | "already-resumed" | "upload-never-finished" };

export type StallPlanInput = {
  status: string;
  processingMetadata: unknown;
  sourceType: string | null;
  storagePath: string | null;
  /** Whether the row carries a name. Only a row the pipeline has touched has one. */
  hasTitle: boolean;
  /** A complete artifact means the row is a status bug, not a stall; reconciliation owns those. */
  hasArtifact: boolean;
  /** Transcript rows exist, so the expensive half of the pipeline is already paid for. */
  hasTranscript: boolean;
  /** `processing.updatedAt`, falling back to the row's `updated_at`, in epoch ms. */
  updatedAt: number;
  now: number;
};

export function hasPendingScanImages(processingMetadata: unknown) {
  return (
    isRecord(processingMetadata) &&
    Array.isArray(processingMetadata.pendingScanImages) &&
    processingMetadata.pendingScanImages.length > 0
  );
}

export function hasPendingDocument(processingMetadata: unknown) {
  return isRecord(processingMetadata) && isRecord(processingMetadata.pendingDocument);
}

export function hasPendingLink(processingMetadata: unknown) {
  return (
    isRecord(processingMetadata) &&
    typeof processingMetadata.pendingLinkUrl === "string" &&
    processingMetadata.pendingLinkUrl.trim().length > 0
  );
}

export function hasPreparedManualImportText(processingMetadata: unknown) {
  return (
    isRecord(processingMetadata) &&
    isRecord(processingMetadata.manualImport) &&
    typeof processingMetadata.manualImport.text === "string" &&
    processingMetadata.manualImport.text.trim().length > 0
  );
}

export function hasPreparedAudioSource(params: {
  sourceType: string | null;
  storagePath: string | null;
  processingMetadata: unknown;
}) {
  if (params.sourceType !== "audio") {
    return false;
  }

  if (params.storagePath) {
    return true;
  }

  return (
    parseAudioChunkManifest(
      isRecord(params.processingMetadata) ? params.processingMetadata.audioChunks : null,
    ).length > 0
  );
}

/** `processing.updatedAt` if the pipeline wrote one, else the caller's fallback. */
export function readProcessingUpdatedAt(processingMetadata: unknown, fallbackIso: string) {
  const stamped =
    isRecord(processingMetadata) && isRecord(processingMetadata.processing)
      ? processingMetadata.processing.updatedAt
      : null;

  const parsed = typeof stamped === "string" ? Date.parse(stamped) : Number.NaN;

  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  const fallback = Date.parse(fallbackIso);
  return Number.isNaN(fallback) ? 0 : fallback;
}

/** How many times a sweep has already paid to resume this lecture. */
export function readStallSweepCount(processingMetadata: unknown) {
  if (!isRecord(processingMetadata)) {
    return 0;
  }

  const sweep = processingMetadata[STALL_SWEEP_METADATA_KEY];

  if (!isRecord(sweep) || typeof sweep.resumes !== "number" || !Number.isFinite(sweep.resumes)) {
    return 0;
  }

  return Math.max(0, Math.trunc(sweep.resumes));
}

/** The metadata to write back when a sweep resumes a lecture, so the next sweep can see it did. */
export function withStallSweepMark(processingMetadata: unknown, nowIso: string) {
  const metadata = isRecord(processingMetadata) ? processingMetadata : {};

  return {
    ...metadata,
    [STALL_SWEEP_METADATA_KEY]: {
      resumes: readStallSweepCount(metadata) + 1,
      lastResumeAt: nowIso,
    },
  };
}

/**
 * The cheapest resume point that still exists, or null when nothing on the row can be resumed.
 *
 * Order is the whole point. A lecture that stalled during note generation still carries the
 * `pendingDocument` metadata that produced its transcript, and re-running document extraction
 * would pay again for text we already hold. So a written transcript (or prepared import text)
 * wins over every source-preparation branch, and the source ladder below it only runs for a
 * lecture that never got that far.
 */
export function planResumeJob(input: {
  processingMetadata: unknown;
  sourceType: string | null;
  storagePath: string | null;
  hasTranscript: boolean;
}): StallResumeJob | null {
  if (input.hasTranscript || hasPreparedManualImportText(input.processingMetadata)) {
    return "notes";
  }

  if (hasPendingScanImages(input.processingMetadata)) {
    return "scan";
  }

  if (hasPendingDocument(input.processingMetadata)) {
    return "document";
  }

  if (hasPendingLink(input.processingMetadata)) {
    return "link";
  }

  if (
    hasPreparedAudioSource({
      sourceType: input.sourceType,
      storagePath: input.storagePath,
      processingMetadata: input.processingMetadata,
    })
  ) {
    return "audio";
  }

  return null;
}

/**
 * A row nothing was ever attached to: no name, no source, no bytes, no transcript.
 *
 * These are not failed uploads, they are bookkeeping. The lecture is inserted before the source
 * exists, so an attempt that dies in the seconds between the two leaves a row that never held
 * anything — most often because the learner pressed cancel, or their phone took the tab away,
 * mid-request. Empty metadata is the whole test: the moment a learner picks a source, something
 * lands in it (`pendingScanImages`, `manualImport`, `pendingDocument`), and a row with any of
 * that is a learner who did work and is owed an explanation.
 */
export function isNeverStartedDraft(input: StallPlanInput) {
  return (
    !input.hasTitle &&
    !input.hasArtifact &&
    !input.hasTranscript &&
    !input.storagePath &&
    (!isRecord(input.processingMetadata) || Object.keys(input.processingMetadata).length === 0)
  );
}

export function planStalledLecture(input: StallPlanInput): StallPlan {
  if (input.status === "ready" || input.status === "failed" || input.hasArtifact) {
    return { action: "wait", reason: "settled" };
  }

  if (input.now - input.updatedAt <= STALL_RESUME_AFTER_MS) {
    return { action: "wait", reason: "recent" };
  }

  if (!RESUMABLE_STATUSES.has(input.status)) {
    /*
     * Deleted rather than failed, and only from here — a row that never left `uploading`.
     *
     * Failing an empty row buys the learner an untitled note pinned to the top of their library,
     * saying an upload they may not remember starting did not finish, with no retry button
     * because there is nothing to retry. 15 of the 71 failed notes in production on 2026-09-05
     * were exactly that, and in every case we could trace, the learner had already made the note
     * they wanted seconds later. There is nothing here to tell them about, so it goes.
     *
     * Deliberately not reachable from the resumable statuses above: a lecture that got as far as
     * `queued` or `generating_notes` had a source once, whatever the row looks like now, and a
     * learner who is owed an explanation must never instead get silence.
     */
    return isNeverStartedDraft(input)
      ? { action: "discard", reason: "never-started" }
      : { action: "fail", reason: "upload-never-finished" };
  }

  if (readStallSweepCount(input.processingMetadata) >= MAX_SWEEP_RESUMES) {
    return { action: "fail", reason: "already-resumed" };
  }

  const job = planResumeJob(input);

  // Nothing left to resume from: the run died before it wrote anything reusable, and re-running
  // it would only re-upload a source the row no longer points at. Fail it so the learner gets a
  // sentence and a retry button instead of a spinner, which costs nothing at all.
  return job ? { action: "resume", job } : { action: "fail", reason: "no-source" };
}
