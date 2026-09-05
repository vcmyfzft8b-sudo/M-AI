import "server-only";

import type { LectureRow } from "@/lib/database.types";
import {
  enqueueLectureDocumentProcessing,
  enqueueLectureLinkProcessing,
  enqueueLectureNotesGeneration,
  enqueueLectureProcessing,
  enqueueLectureScanProcessing,
} from "@/lib/jobs";
import { expectedInputFailure, sourceLocaleMessage } from "@/lib/lecture-failure-text";
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
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

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

export type StallSweepOutcome = {
  scanned: number;
  reconciled: number;
  resumed: Array<{ lectureId: string; job: StallResumeJob }>;
  failed: string[];
  /** Empty drafts removed rather than failed. See `isNeverStartedDraft`. */
  discarded: string[];
  waiting: number;
  deferred: number;
  errors: Array<{ lectureId: string; message: string }>;
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
    .lt("updated_at", new Date(now - STALL_RESUME_AFTER_MS).toISOString())
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

export async function sweepStalledLectures(now = Date.now()): Promise<StallSweepOutcome> {
  const outcome: StallSweepOutcome = {
    scanned: 0,
    reconciled: 0,
    resumed: [],
    failed: [],
    discarded: [],
    waiting: 0,
    deferred: 0,
    errors: [],
  };

  const candidates = await loadCandidates(now);
  outcome.scanned = candidates.length;

  if (candidates.length === 0) {
    return outcome;
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

  return outcome;
}
