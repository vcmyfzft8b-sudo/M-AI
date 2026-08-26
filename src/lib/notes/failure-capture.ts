import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

import { buildFailureCaptureRecord, MAX_CAPTURE_CHARS } from "./failure-capture-record.ts";

/**
 * Snapshots the exact source material a failed lecture was generated from, so the error-triage
 * automation can reproduce the failure with the real input instead of reasoning from a stack
 * trace (docs/error-triage-automation.md, "Reproducing with the user's actual material").
 *
 * Deliberately fail-open everywhere: the capture is an aid to debugging a failure that has
 * already been recorded — it must never become a second failure. One row per lecture, latest
 * failure wins; rows older than 30 days are pruned opportunistically on write, and the rest die
 * with their lecture via the migration's cascade.
 */

const CAPTURE_RETENTION_DAYS = 30;
const TRANSCRIPT_FETCH_PAGE = 1000;
const TRANSCRIPT_FETCH_MAX_ROWS = 10_000;

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

export async function captureGenerationFailureInput(params: {
  lectureId: string;
  userId: string | null;
  sourceType: string | null;
  languageHint: string | null;
  errorMessage: string | null;
  processingMetadata: unknown;
}) {
  try {
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

    const supabase = createSupabaseServiceRoleClient();
    // captured_at is set explicitly so a re-failure refreshes it — "latest failure wins" is the
    // retention contract, and an upsert without the column would keep the original timestamp.
    const { error } = await supabase
      .from("generation_failure_captures")
      .upsert({ ...record, captured_at: new Date().toISOString() } as never, {
        onConflict: "lecture_id",
      });

    if (error) {
      console.warn("Failure-input capture write failed; continuing without it.", error.message);
      return;
    }

    // Opportunistic retention: the table only ever holds recent, actionable failures.
    const cutoff = new Date(Date.now() - CAPTURE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await supabase
      .from("generation_failure_captures")
      .delete()
      .lt("captured_at", cutoff.toISOString());
  } catch (error) {
    console.warn("Failure-input capture failed; continuing without it.", error);
  }
}
