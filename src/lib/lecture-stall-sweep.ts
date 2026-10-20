import "server-only";

import { AI_PROVIDER_SPEND_CAP_FAILURE_CODE } from "@/lib/ai/errors";
import { probeGemini } from "@/lib/ai/gemini";
import type { LectureRow } from "@/lib/database.types";
import {
  enqueueLectureDocumentProcessing,
  enqueueLectureLinkProcessing,
  enqueueLectureNotesGeneration,
  enqueueLectureProcessing,
  enqueueLectureScanProcessing,
} from "@/lib/jobs";
import { expectedInputFailure, sourceLocaleMessage } from "@/lib/lecture-failure-text";
import { LECTURE_FAILURE_METADATA_KEY } from "@/lib/lecture-failure-codes";
import { LectureProcessingStalledError } from "@/lib/lecture-processing-errors";
import {
  planStalledLecture,
  readProcessingUpdatedAt,
  withStallSweepMark,
  STALLED_LECTURE_STATUSES,
  STALL_RESUME_AFTER_MS,
  type StallResumeJob,
} from "@/lib/lecture-stall-plan";
import { reconcileLecturesWithArtifacts } from "@/lib/lectures";
import { markLecturePipelineFailed } from "@/lib/pipeline";
import {
  planProviderOutageRetry,
  withProviderOutageRetryMark,
} from "@/lib/provider-outage-plan";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { HAS_TEXT_PATTERN, backfillTranscriptEmbeddings } from "@/lib/transcript-embeddings";
import { salvageAbandonedUpload, UPLOAD_SALVAGE_AFTER_MS } from "@/lib/upload-salvage";

/**
 * Settles lectures whose pipeline run died without saying so, without waiting for the learner to
 * open the note. See `lecture-stall-plan.ts` for the policy and why it is shaped by cost.
 *
 * Every run ends with each lecture it touched in a terminal state or on its way to one: ready
 * (the notes were there all along and only the status was wrong), resumed once, deleted where the
 * row never held anything at all, or failed with a sentence the note screen renders in the
 * reader's language — `processing_stalled` for a run that died on our side, `upload_incomplete`
 * for a file the browser started sending and never finished.
 */

/**
 * Rows read per run. Comfortably above the whole 30-day backlog (18 rows on 2026-09-05), so this
 * is a guard against a pathological table rather than a page size anyone should hit.
 */
const MAX_CANDIDATES = 200;

/**
 * Lectures a single run will pay to resume. The backlog runs at roughly one every other day, so
 * this only ever binds if something upstream is failing in bulk — exactly when spending the
 * afternoon re-running it would be the wrong move. The rest wait for the next run.
 */
const MAX_RESUMES_PER_RUN = 10;

/** Nothing older than this can still be pending anything; older rows are abandoned, not stalled. */
const MAX_CANDIDATE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Lectures the spend cap stopped that one run will retry once Gemini answers. Higher than the
 * stall resumes: these are not suspect runs but healthy ones that were refused, and on 2026-10-20
 * all 17 the cap had failed went through at once when re-run by hand. A longer outage leaves more,
 * and the rest follow an hour apart rather than all at once on a provider that has just come back.
 */
const MAX_OUTAGE_RETRIES_PER_RUN = 25;

/**
 * How far back the sweep looks for transcript rows saved without an embedding. The cap resets on
 * the 1st, so an outage can last days; two weeks covers that with room, without retrying forever
 * a row Google will never embed.
 */
const EMBEDDING_BACKFILL_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

/** Rows one run embeds. About twenty seconds of work; a larger backlog finishes over a few runs. */
const EMBEDDING_BACKFILL_MAX_SEGMENTS_PER_RUN = 1_000;

export type ProviderOutageOutcome = {
  /** Whether Gemini was asked, and what it said. Only asked when there is something to recover. */
  probe: "skipped" | "ok" | "spend_cap" | "unavailable";
  retried: Array<{ lectureId: string; job: StallResumeJob }>;
  /** Spend-cap lectures past this run's limit, left for the next one. */
  deferred: number;
  embeddingsFilled: number;
  /** A backfill that failed: logged with the outcome, and retried by the next run. */
  embeddingBackfillError: string | null;
};

export type StallSweepOutcome = {
  scanned: number;
  reconciled: number;
  resumed: Array<{ lectureId: string; job: StallResumeJob }>;
  failed: string[];
  /** Empty drafts removed rather than failed. See `isNeverStartedDraft`. */
  discarded: string[];
  /** Uploads the device never confirmed, finished from what reached storage. */
  salvaged: string[];
  waiting: number;
  deferred: number;
  errors: Array<{ lectureId: string; message: string }>;
  /** Lectures and transcripts the Gemini spend cap left unfinished. See `recoverFromProviderOutage`. */
  providerOutage: ProviderOutageOutcome;
};

type SweepLectureRow = Pick<
  LectureRow,
  | "id"
  | "status"
  | "processing_metadata"
  | "source_type"
  | "storage_path"
  | "title"
  | "updated_at"
>;

async function loadCandidates(now: number): Promise<LectureRow[]> {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("lectures")
    .select("*")
    .in("status", [...STALLED_LECTURE_STATUSES])
    // Uploads are looked at sooner than stalled runs: an unconfirmed upload is finished from what
    // reached storage after UPLOAD_SALVAGE_AFTER_MS, while everything else still waits the full
    // STALL_RESUME_AFTER_MS (the plan returns "recent" for those in between).
    .lt("updated_at", new Date(now - Math.min(STALL_RESUME_AFTER_MS, UPLOAD_SALVAGE_AFTER_MS)).toISOString())
    .gt("updated_at", new Date(now - MAX_CANDIDATE_AGE_MS).toISOString())
    .order("updated_at", { ascending: true })
    .limit(MAX_CANDIDATES);

  if (error) {
    throw error;
  }

  return (data ?? []) as LectureRow[];
}

/**
 * Which of these lectures already have transcript rows.
 *
 * Asked per lecture with a head-only count rather than as one `in` query, because a single
 * lecture can carry hundreds of segments and the sweep only needs the boolean. Candidate counts
 * are in the tens, so this is tens of empty responses, not a table scan.
 */
async function loadTranscriptPresence(lectureIds: string[]): Promise<Set<string>> {
  const supabase = createSupabaseServiceRoleClient();
  const present = new Set<string>();

  await Promise.all(
    lectureIds.map(async (lectureId) => {
      const { count, error } = await supabase
        .from("transcript_segments")
        .select("lecture_id", { count: "exact", head: true })
        .eq("lecture_id", lectureId)
        .limit(1);

      if (error) {
        throw error;
      }

      if ((count ?? 0) > 0) {
        present.add(lectureId);
      }
    }),
  );

  return present;
}

const RESUME_JOBS: Record<StallResumeJob, (lectureId: string) => Promise<void>> = {
  notes: enqueueLectureNotesGeneration,
  scan: enqueueLectureScanProcessing,
  document: enqueueLectureDocumentProcessing,
  link: enqueueLectureLinkProcessing,
  audio: enqueueLectureProcessing,
};

/**
 * Stamps the resume before enqueueing it, never after.
 *
 * The mark is what stops a lecture being resumed a second time, so it has to be durable before
 * the job can exist. Written the other way round, an invocation killed between the two would
 * leave a lecture that gets re-enqueued on every sweep forever — the runaway bill this whole
 * module is built to avoid.
 */
async function markResumed(lecture: SweepLectureRow, nowIso: string) {
  const metadata = withStallSweepMark(lecture.processing_metadata, nowIso);
  const { error } = await createSupabaseServiceRoleClient()
    .from("lectures")
    .update({ processing_metadata: metadata } as never)
    .eq("id", lecture.id);

  if (error) {
    throw error;
  }
}

/**
 * Removes a draft nothing was ever attached to.
 *
 * Safe to do plainly, with no storage sweep behind it: `isNeverStartedDraft` has already
 * established there is no file, no transcript and no artifact, and the row's children would go
 * with it on the cascade in any case. What we are deleting is a row the learner never saw fill.
 */
async function discardEmptyDraft(lectureId: string) {
  const { error } = await createSupabaseServiceRoleClient()
    .from("lectures")
    .delete()
    .eq("id", lectureId);

  if (error) {
    throw error;
  }
}

/** Failed lectures recorded with the spend-cap code. A handful normally; none most days. */
async function loadSpendCapFailures(now: number): Promise<LectureRow[]> {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("lectures")
    .select("*")
    .eq("status", "failed")
    .eq(`processing_metadata->${LECTURE_FAILURE_METADATA_KEY}->>code`, AI_PROVIDER_SPEND_CAP_FAILURE_CODE)
    .gt("updated_at", new Date(now - MAX_CANDIDATE_AGE_MS).toISOString())
    .order("updated_at", { ascending: true })
    .limit(MAX_CANDIDATES);

  if (error) {
    throw error;
  }

  return (data ?? []) as LectureRow[];
}

/** Whether any recent transcript row is still waiting for its embedding. One row is enough. */
async function hasMissingEmbeddings(since: string) {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("transcript_segments")
    .select("id")
    .is("embedding", null)
    .filter("text", "match", HAS_TEXT_PATTERN)
    .gte("created_at", since)
    .limit(1);

  if (error) {
    throw error;
  }

  return (data ?? []).length > 0;
}

/**
 * Re-queues one lecture the spend cap stopped, the way the learner's retry button would.
 *
 * The row is stamped and requeued in one conditional write — only while it is still the failed row
 * that was read — and before the job exists, never after, for the reason `markResumed` gives: the
 * stamp is what stops a second retry, so it must be durable first. A row that changed was retried
 * or deleted by its owner in the meantime and is left to that.
 */
async function retryAfterProviderOutage(
  lecture: LectureRow,
  job: StallResumeJob,
  nowIso: string,
): Promise<boolean> {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("lectures")
    .update({
      status: "queued",
      error_message: null,
      processing_metadata: withProviderOutageRetryMark(lecture.processing_metadata, nowIso),
    } as never)
    .eq("id", lecture.id)
    .eq("status", "failed")
    // Unchanged since it was read: a learner who retried it in between, and saw it fail again for
    // another reason, is not overruled by a plan made from the row before theirs.
    .eq("updated_at", lecture.updated_at)
    .select("id");

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    return false;
  }

  try {
    await RESUME_JOBS[job](lecture.id);
  } catch (enqueueError) {
    // As in the retry route: a job that could not even be started is a failure the learner sees,
    // with its own message rather than the spend cap's, and with the stamp on the row it is not
    // retried again by the sweep.
    await markLecturePipelineFailed({ lectureId: lecture.id, error: enqueueError });
    throw enqueueError;
  }

  return true;
}

/**
 * Finishes what the Gemini spend cap stopped, once Gemini answers again.
 *
 * Two kinds of leftovers: lectures that failed with the spend-cap code (photos and scanned PDFs
 * have no other reader, so those fail honestly and wait here), and transcripts saved without their
 * search embeddings (src/lib/transcript-embeddings.ts). Gemini is asked first, with one embedding
 * of one word, and only when there is something to recover — so an outage that is still going
 * costs one refused call an hour, and a normal day costs two empty reads.
 */
async function recoverFromProviderOutage(
  now: number,
  errors: StallSweepOutcome["errors"],
): Promise<ProviderOutageOutcome> {
  const outcome: ProviderOutageOutcome = {
    probe: "skipped",
    retried: [],
    deferred: 0,
    embeddingsFilled: 0,
    embeddingBackfillError: null,
  };
  const backfillSince = new Date(now - EMBEDDING_BACKFILL_LOOKBACK_MS).toISOString();
  const failures = await loadSpendCapFailures(now);
  const withTranscript = await loadTranscriptPresence(failures.map((lecture) => lecture.id));
  const plans = failures.flatMap((lecture) => {
    const plan = planProviderOutageRetry({
      status: lecture.status,
      processingMetadata: lecture.processing_metadata,
      sourceType: lecture.source_type,
      storagePath: lecture.storage_path,
      hasTranscript: withTranscript.has(lecture.id),
    });

    return plan.action === "retry" ? [{ lecture, job: plan.job }] : [];
  });

  if (plans.length === 0 && !(await hasMissingEmbeddings(backfillSince))) {
    return outcome;
  }

  const probe = await probeGemini();

  if (!probe.ok) {
    outcome.probe = probe.spendCap ? "spend_cap" : "unavailable";
    outcome.deferred = plans.length;
    return outcome;
  }

  outcome.probe = "ok";
  const nowIso = new Date(now).toISOString();

  for (const { lecture, job } of plans) {
    if (outcome.retried.length >= MAX_OUTAGE_RETRIES_PER_RUN) {
      outcome.deferred += 1;
      continue;
    }

    try {
      if (await retryAfterProviderOutage(lecture, job, nowIso)) {
        outcome.retried.push({ lectureId: lecture.id, job });
      }
    } catch (error) {
      errors.push({
        lectureId: lecture.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const backfill = await backfillTranscriptEmbeddings({
      since: backfillSince,
      maxSegments: EMBEDDING_BACKFILL_MAX_SEGMENTS_PER_RUN,
    });

    outcome.embeddingsFilled = backfill.filled;
  } catch (error) {
    outcome.embeddingBackfillError = error instanceof Error ? error.message : String(error);
  }

  return outcome;
}

export async function sweepStalledLectures(now = Date.now()): Promise<StallSweepOutcome> {
  const outcome: StallSweepOutcome = {
    scanned: 0,
    reconciled: 0,
    resumed: [],
    failed: [],
    discarded: [],
    salvaged: [],
    waiting: 0,
    deferred: 0,
    errors: [],
    providerOutage: {
      probe: "skipped",
      retried: [],
      deferred: 0,
      embeddingsFilled: 0,
      embeddingBackfillError: null,
    },
  };

  await settleStalledLectures(now, outcome);

  // After the stalls, so a lecture re-queued here is not also looked at as a stall in the same run.
  outcome.providerOutage = await recoverFromProviderOutage(now, outcome.errors);

  return outcome;
}

async function settleStalledLectures(now: number, outcome: StallSweepOutcome) {
  const candidates = await loadCandidates(now);
  outcome.scanned = candidates.length;

  if (candidates.length === 0) {
    return;
  }

  // First, the free tier: a lecture whose notes were written but whose status never caught up is
  // not stalled at all, and flipping it to ready costs nothing. Doing this before anything else
  // also keeps the sweep from paying to regenerate notes that already exist.
  const reconciled = await reconcileLecturesWithArtifacts(candidates);
  const stillStalled = reconciled.filter(
    (lecture) => lecture.status !== "ready" && lecture.status !== "failed",
  );
  outcome.reconciled = reconciled.length - stillStalled.length;

  const withTranscript = await loadTranscriptPresence(stillStalled.map((lecture) => lecture.id));
  const nowIso = new Date(now).toISOString();

  for (const lecture of stillStalled) {
    // Before an upload is failed or discarded, finish it from whatever reached storage.
    if (
      lecture.status === "uploading" &&
      now - readProcessingUpdatedAt(lecture.processing_metadata, lecture.updated_at) >
        UPLOAD_SALVAGE_AFTER_MS
    ) {
      try {
        const salvage = await salvageAbandonedUpload(lecture);

        if (salvage.outcome === "salvaged") {
          outcome.salvaged.push(lecture.id);
          continue;
        }
      } catch (error) {
        outcome.errors.push({
          lectureId: lecture.id,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    const plan = planStalledLecture({
      status: lecture.status,
      processingMetadata: lecture.processing_metadata,
      sourceType: lecture.source_type,
      storagePath: lecture.storage_path,
      hasTitle: Boolean(lecture.title && lecture.title.trim().length > 0),
      // Reconciliation above already promoted every lecture whose artifact was complete, so an
      // artifact still sitting here is an incomplete one the pipeline has yet to finish.
      hasArtifact: false,
      hasTranscript: withTranscript.has(lecture.id),
      updatedAt: readProcessingUpdatedAt(lecture.processing_metadata, lecture.updated_at),
      now,
    });

    if (plan.action === "wait") {
      outcome.waiting += 1;
      continue;
    }

    try {
      if (plan.action === "discard") {
        await discardEmptyDraft(lecture.id);
        outcome.discarded.push(lecture.id);
        continue;
      }

      if (plan.action === "resume") {
        if (outcome.resumed.length >= MAX_RESUMES_PER_RUN) {
          outcome.deferred += 1;
          continue;
        }

        await markResumed(lecture, nowIso);
        await RESUME_JOBS[plan.job](lecture.id);
        outcome.resumed.push({ lectureId: lecture.id, job: plan.job });
        continue;
      }

      // An upload the browser never finished is not a defect on our side — the learner closed the
      // tab — so it fails as an expected input failure, which keeps it out of Sentry and tells
      // them to upload again rather than to press a retry that has nothing to run on. A run that
      // died mid-pipeline is the opposite: nothing about their file caused it, so it keeps its
      // retry button and still reaches Sentry.
      await markLecturePipelineFailed({
        lectureId: lecture.id,
        error:
          plan.reason === "upload-never-finished"
            ? expectedInputFailure("upload_incomplete")
            : new LectureProcessingStalledError(
                sourceLocaleMessage("failure.processing_stalled"),
              ),
      });
      outcome.failed.push(lecture.id);
    } catch (error) {
      // One lecture that cannot be settled must not strand the rest of the backlog behind it.
      outcome.errors.push({
        lectureId: lecture.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
