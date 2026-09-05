// Imported by its real filename so the Node test runner can load this module directly.
import { isRecord } from "./lecture-source-metadata.ts";

/**
 * Whether a draft row a learner already owns can stand in for the one they are asking for.
 *
 * The manual-import routes insert the lecture before the source exists, so an attempt that dies
 * in between leaves an empty row that nothing will ever fill. The learner's next move is to press
 * the button again, and without this each press buys another one. Adopting the empty draft is
 * what makes pressing again idempotent.
 */

/**
 * How recently the draft has to have been created to be worth adopting.
 *
 * Ten minutes, deliberately far short of the stall sweep's hour rather than equal to it. Adopting
 * a row does not touch its timestamps, so a draft handed back at fifty-nine minutes would carry
 * an `updated_at` almost old enough for the sweep to settle it — and the sweep could delete or
 * fail the very row the learner is at that moment uploading into. Ten minutes keeps an adopted
 * draft nowhere near that bar, and is still two orders of magnitude more than a retry takes: the
 * ones that stranded rows in production were six, eleven and twenty-eight seconds apart.
 */
export const EMPTY_DRAFT_REUSE_WINDOW_MS = 10 * 60 * 1000;

export type ReusableDraftCandidate = {
  id: string;
  status: string;
  title: string | null;
  storage_path: string | null;
  source_type: string | null;
  access_tier: string | null;
  processing_metadata: unknown;
  created_at: string;
};

/**
 * Empty means empty: no title, no file, and no source metadata of any kind.
 *
 * The metadata check is the one that carries the weight. `pendingScanImages` is written when the
 * photo upload URLs are issued, well before the bytes land, so a row can look untouched while a
 * learner is mid-upload on it. Handing that id to a second attempt would have the two overwrite
 * each other — the one failure mode worse than the empty note this exists to prevent.
 */
export function isReusableEmptyDraft(
  candidate: ReusableDraftCandidate,
  params: { sourceType: string; accessTier: string; now: number },
) {
  if (candidate.status !== "uploading") {
    return false;
  }

  if (candidate.source_type !== params.sourceType || candidate.access_tier !== params.accessTier) {
    return false;
  }

  if (candidate.title || candidate.storage_path) {
    return false;
  }

  if (isRecord(candidate.processing_metadata) && Object.keys(candidate.processing_metadata).length > 0) {
    return false;
  }

  const createdAt = Date.parse(candidate.created_at);

  if (Number.isNaN(createdAt)) {
    return false;
  }

  return params.now - createdAt <= EMPTY_DRAFT_REUSE_WINDOW_MS;
}

/** The columns `isReusableEmptyDraft` reads, as a PostgREST select list. */
export const REUSABLE_DRAFT_COLUMNS =
  "id, status, title, storage_path, source_type, access_tier, processing_metadata, created_at";
