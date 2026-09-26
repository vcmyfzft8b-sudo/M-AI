#!/usr/bin/env node
/**
 * Finds the notes that did not finish in a window, for the note-triage automation.
 *
 * Two kinds, read straight from production with the service-role key:
 *  - failed: lectures marked `failed` in the window, plus failures whose lecture the learner has
 *    since deleted (generation_failure_captures outlives the lecture, 0033), which is most of them;
 *  - stuck: lectures still not ready or failed two hours after they last moved.
 *
 * Each finding carries what triage needs to decide whether the learner's material could have made
 * a note: the failure code, the source type, and the size of what was captured. It never carries
 * the material itself. The agent fetches that on demand and keeps it out of git.
 *
 *   node scripts/note-failure-scan.mjs --since <iso> --until <iso> --out <file>
 *
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 * Exit codes: 0 scanned, 2 misconfigured, 1 crashed. Node built-ins only, so it runs before npm ci.
 */

import fs from "node:fs";

const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const since = arg("since");
const until = arg("until") || new Date().toISOString();
const out = arg("out");

if (!url || !key || !since || !out) {
  console.error("usage: note-failure-scan.mjs --since <iso> --until <iso> --out <file> (needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(2);
}

/** Stuck means no stage movement for this long; the stall sweep settles most rows well before. */
const STUCK_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * Failures that are the material, decided by code alone, where no reading of the capture could
 * change the verdict. Everything else is looked at: a code only says what the pipeline concluded,
 * and the 2026-09 review found most "your material has nothing to learn from" verdicts wrong.
 */
const MATERIAL_ONLY_CODES = new Set([
  "link_requires_login",
  "private_network_link",
  "unsupported_link_protocol",
  "unsupported_video_link",
]);

async function get(path) {
  const response = await fetch(`${url}${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });

  if (!response.ok) {
    throw new Error(`GET ${path.split("?")[0]} -> ${response.status} ${(await response.text()).slice(0, 200)}`);
  }

  return response.json();
}

function failureCode(metadata) {
  const code = metadata?.failure?.code;
  return typeof code === "string" ? code : null;
}

try {
  const window = `updated_at=gte.${encodeURIComponent(since)}&updated_at=lt.${encodeURIComponent(until)}`;
  const failed = await get(
    `/rest/v1/lectures?select=id,user_id,source_type,status,error_message,created_at,updated_at,processing_metadata&status=eq.failed&${window}&order=updated_at.asc&limit=1000`,
  );
  const captures = await get(
    `/rest/v1/generation_failure_captures?select=lecture_id,user_id,source_type,error_message,source_char_count,captured_files,captured_at&captured_at=gte.${encodeURIComponent(since)}&captured_at=lt.${encodeURIComponent(until)}&order=captured_at.asc&limit=1000`,
  );
  const stuckBefore = new Date(Date.parse(until) - STUCK_AFTER_MS).toISOString();
  const stuck = await get(
    `/rest/v1/lectures?select=id,user_id,source_type,status,created_at,updated_at,processing_metadata&status=in.(uploading,queued,transcribing,generating_notes)&updated_at=lt.${encodeURIComponent(stuckBefore)}&updated_at=gte.${encodeURIComponent(new Date(Date.parse(until) - 7 * 864e5).toISOString())}&limit=500`,
  );
  const readyCount = (
    await get(
      `/rest/v1/lectures?select=id&status=eq.ready&created_at=gte.${encodeURIComponent(since)}&created_at=lt.${encodeURIComponent(until)}&limit=5000`,
    )
  ).length;

  const lecturesById = new Map(failed.map((lecture) => [lecture.id, lecture]));
  const capturesById = new Map(captures.map((capture) => [capture.lecture_id, capture]));
  const ids = new Set([...lecturesById.keys(), ...capturesById.keys()]);
  const findings = [];

  for (const id of ids) {
    const lecture = lecturesById.get(id) ?? null;
    const capture = capturesById.get(id) ?? null;
    const metadata = lecture?.processing_metadata ?? null;
    const code = failureCode(metadata);
    const capturedFiles = Array.isArray(capture?.captured_files) ? capture.captured_files.length : 0;

    findings.push({
      kind: "failed",
      lectureId: id,
      userId: lecture?.user_id ?? capture?.user_id ?? null,
      deletedByLearner: !lecture,
      at: lecture?.updated_at ?? capture?.captured_at,
      sourceType: lecture?.source_type ?? capture?.source_type ?? null,
      code,
      // The row's own sentence, for failures from before codes were recorded.
      message: (lecture?.error_message ?? capture?.error_message ?? "").slice(0, 200),
      capturedChars: capture?.source_char_count ?? 0,
      capturedFiles,
      hasCapture: Boolean(capture),
      linkUrl:
        typeof metadata?.pendingLinkUrl === "string"
          ? metadata.pendingLinkUrl
          : metadata?.manualImport?.modelMetadata?.sourceUrl ?? null,
      triage: code && MATERIAL_ONLY_CODES.has(code) ? "material-only" : "review",
    });
  }

  for (const lecture of stuck) {
    findings.push({
      kind: "stuck",
      lectureId: lecture.id,
      userId: lecture.user_id,
      deletedByLearner: false,
      at: lecture.updated_at,
      sourceType: lecture.source_type,
      code: null,
      message: `still ${lecture.status}; stage ${lecture.processing_metadata?.processing?.stage ?? "unknown"}`,
      capturedChars: 0,
      capturedFiles: 0,
      hasCapture: false,
      linkUrl: null,
      triage: "review",
    });
  }

  const report = {
    since,
    until,
    readyInWindow: readyCount,
    failedInWindow: findings.filter((finding) => finding.kind === "failed").length,
    stuck: findings.filter((finding) => finding.kind === "stuck").length,
    toReview: findings.filter((finding) => finding.triage === "review").length,
    findings,
  };

  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      readyInWindow: report.readyInWindow,
      failedInWindow: report.failedInWindow,
      stuck: report.stuck,
      toReview: report.toReview,
    }),
  );
} catch (error) {
  console.error(`note-failure-scan crashed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
