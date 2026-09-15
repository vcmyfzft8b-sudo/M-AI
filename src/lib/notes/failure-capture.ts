import { assertStorageOwnerActive } from "@/lib/mobile/storage-owner";
import "server-only";

import { STORAGE_BUCKET } from "@/lib/constants";
import { extractScanImageStoragePaths } from "@/lib/scan-image-uploads";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

import {
  buildFailureCaptureRecord,
  resolveOriginalFileReferences,
  MAX_CAPTURE_CHARS,
  type OriginalFileReference,
} from "./failure-capture-record.ts";

/**
 * Snapshots the exact source material a failed lecture was generated from, so the error-triage
 * automation can reproduce the failure with the real input instead of reasoning from a stack
 * trace (docs/error-triage-automation.md, "Reproducing with the user's actual material").
 *
 * The capture must outlive the lecture: the learner whose lecture just failed is exactly the one
 * likely to delete it, and lecture deletion also removes the original uploads from storage. So
 * the row has no FK cascade (migration 0033) and the original files are copied under the
 * failure-captures/ prefix at capture time; the 30-day prune removes both together, which is the
 * retention bound for this user content.
 *
 * Deliberately fail-open everywhere: the capture is an aid to debugging a failure that has
 * already been recorded — it must never become a second failure.
 */

const CAPTURE_RETENTION_DAYS = 30;
const TRANSCRIPT_FETCH_PAGE = 1000;
const TRANSCRIPT_FETCH_MAX_ROWS = 10_000;
const CAPTURE_STORAGE_PREFIX = "failure-captures";
const PRUNE_BATCH = 50;

async function loadTranscriptText(lectureId: string): Promise<string | null> {
  const supabase = createSupabaseServiceRoleClient();
  const parts: string[] = [];
  let totalChars = 0;

  for (let from = 0; from < TRANSCRIPT_FETCH_MAX_ROWS; from += TRANSCRIPT_FETCH_PAGE) {
    const { data, error } = await supabase
      .from("transcript_segments")
      .select("text")
      .eq("lecture_id", lectureId)
      .order("idx", { ascending: true })
      .range(from, from + TRANSCRIPT_FETCH_PAGE - 1);

    if (error || !data) {
      break;
    }

    for (const row of data as Array<{ text: string }>) {
      parts.push(row.text);
      totalChars += row.text.length;
    }

    if (data.length < TRANSCRIPT_FETCH_PAGE || totalChars >= MAX_CAPTURE_CHARS) {
      break;
    }
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

function captureCopyPath(lectureId: string, index: number, originalPath: string) {
  const baseName = originalPath.split("/").pop() || "file";

  return `${CAPTURE_STORAGE_PREFIX}/${lectureId}/${index}-${baseName}`;
}

/**
 * Copies each original upload into the capture prefix. Server-side storage copies, one per file,
 * each fail-open: a missing original (already cleaned up, or a path that never existed) just
 * is not captured.
 */
async function copyOriginalFiles(userId: string, lectureId: string, references: OriginalFileReference[]) {
  const storage = createSupabaseServiceRoleClient().storage.from(STORAGE_BUCKET);
  const captured: Array<OriginalFileReference & { capturedPath: string }> = [];

  for (const [index, reference] of references.entries()) {
    const capturedPath = captureCopyPath(lectureId, index, reference.path);

    try {
      await assertStorageOwnerActive(userId);
      const { error } = await storage.copy(reference.path, capturedPath);

      if (!error) {
        captured.push({ ...reference, capturedPath });
      }
    } catch {
      // Fail-open per file.
    }
  }

  return captured;
}

/** Removes expired rows and the storage copies they own. */
async function pruneExpiredCaptures() {
  try {
    const supabase = createSupabaseServiceRoleClient();
    const cutoff = new Date(Date.now() - CAPTURE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("generation_failure_captures")
      .select("lecture_id, captured_files")
      .lt("captured_at", cutoff)
      .limit(PRUNE_BATCH);

    if (error || !data || data.length === 0) {
      return;
    }

    const paths = (data as Array<{ captured_files: unknown }>)
      .flatMap((row) => (Array.isArray(row.captured_files) ? row.captured_files : []))
      .map((file) =>
        file && typeof file === "object" && "capturedPath" in file
          ? (file as { capturedPath?: unknown }).capturedPath
          : null,
      )
      .filter((path): path is string => typeof path === "string" && path.length > 0);

    if (paths.length > 0) {
      await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    }

    await supabase
      .from("generation_failure_captures")
      .delete()
      .in(
        "lecture_id",
        (data as Array<{ lecture_id: string }>).map((row) => row.lecture_id),
      );
  } catch (error) {
    console.warn("Failure-capture pruning failed; will retry on a later capture.", error);
  }
}

export async function captureGenerationFailureInput(params: {
  lectureId: string;
  userId: string | null;
  sourceType: string | null;
  languageHint: string | null;
  errorMessage: string | null;
  processingMetadata: unknown;
  storagePath: string | null;
}) {
  if (!params.userId) return;
  try {
    await assertStorageOwnerActive(params.userId);
    const metadata =
      params.processingMetadata &&
      typeof params.processingMetadata === "object" &&
      !Array.isArray(params.processingMetadata)
        ? (params.processingMetadata as Record<string, unknown>)
        : {};
    const manualImport = metadata.manualImport as { text?: unknown } | undefined;
    const hasManualText =
      typeof manualImport?.text === "string" && manualImport.text.trim().length > 0;

    const record = buildFailureCaptureRecord({
      lectureId: params.lectureId,
      userId: params.userId,
      sourceType: params.sourceType,
      languageHint: params.languageHint,
      errorMessage: params.errorMessage,
      processingMetadata: params.processingMetadata,
      transcriptText: hasManualText ? null : await loadTranscriptText(params.lectureId),
    });

    const capturedFiles = await copyOriginalFiles(
      params.userId,
      params.lectureId,
      resolveOriginalFileReferences({
        storagePath: params.storagePath,
        processingMetadata: params.processingMetadata,
        scanImagePaths: extractScanImageStoragePaths(params.processingMetadata),
      }),
    );

    const supabase = createSupabaseServiceRoleClient();
    await assertStorageOwnerActive(params.userId);
    // captured_at is set explicitly so a re-failure refreshes it — "latest failure wins" is the
    // retention contract, and an upsert without the column would keep the original timestamp.
    const { error } = await supabase
      .from("generation_failure_captures")
      .upsert(
        {
          ...record,
          captured_files: capturedFiles,
          captured_at: new Date().toISOString(),
        } as never,
        { onConflict: "lecture_id" },
      );

    if (error) {
      console.warn("Failure-input capture write failed; continuing without it.", error.message);
      return;
    }

    await pruneExpiredCaptures();
  } catch (error) {
    console.warn("Failure-input capture failed; continuing without it.", error);
  }
}
