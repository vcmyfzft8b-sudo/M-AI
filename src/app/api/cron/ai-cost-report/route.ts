import { NextResponse, type NextRequest } from "next/server";

import {
  findCostAnomalies,
  summarizeAiUsageByDay,
  summarizeGenerationByDay,
  DEFAULT_DAILY_ALERT_USD,
  DEFAULT_LECTURE_ALERT_USD,
  type AiUsageRow,
  type GenerationKind,
  type GenerationRow,
} from "@/lib/ai-cost-report";
import { captureRouteError } from "@/lib/monitoring";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Daily AI-spend report over `ai_usage_events`, split by billing source (Google direct vs the
 * OpenRouter gateway) — the watch the 2026-08-25 cost spike earned. Two consumers:
 *
 * - Vercel Cron calls it every morning (vercel.json). When yesterday crossed an alarm threshold
 *   it reports the anomaly to Sentry, which the "new production issue" alert turns into an
 *   email within seconds — the same proven path a failed lecture takes. Repeated anomaly days
 *   group into one Sentry issue; resolving that issue re-arms the email for the next one.
 * - The scheduled morning-summary agent fetches it read-only for the daily numbers.
 *
 * Auth accepts the shared cron secrets plus AI_COST_REPORT_SECRET, a dedicated secret that
 * unlocks only this read-only endpoint, so the summary consumer never has to hold a secret
 * that can trigger paid work elsewhere.
 */

const MAX_REPORT_DAYS = 30;
const USAGE_PAGE_SIZE = 1000;
/** Far above any healthy week; stops a pathological table from turning the report into the outage. */
const MAX_USAGE_ROWS = 60_000;
/** Artifact rows run ~50/day per kind, so this is a runaway guard, not a real ceiling. */
const MAX_GENERATION_ROWS = 20_000;

/**
 * Where each artifact records its outcome. The three study tables are re-stamped on every status
 * write (see setStudyAssetStatus and friends), so `generated_at` is when the attempt settled.
 * Lectures have no such column -- `updated_at` there also moves on a rename or a folder change --
 * so notes bucket by `created_at`, which reads as "lectures uploaded that day and how they turned
 * out". In production only ~1% of a day's lectures are still in flight when the report runs.
 */
const GENERATION_SOURCES: Array<{
  kind: GenerationKind;
  table: string;
  timestampColumn: string;
}> = [
  { kind: "notes", table: "lectures", timestampColumn: "created_at" },
  { kind: "flashcards", table: "lecture_study_assets", timestampColumn: "generated_at" },
  { kind: "quizzes", table: "lecture_quiz_assets", timestampColumn: "generated_at" },
  {
    kind: "practiceTests",
    table: "lecture_practice_test_assets",
    timestampColumn: "generated_at",
  },
];

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  const secrets = [
    process.env.CRON_SECRET,
    process.env.INTERNAL_JOB_SECRET,
    process.env.AI_COST_REPORT_SECRET,
  ]
    .map((secret) => secret?.trim())
    .filter((secret): secret is string => Boolean(secret));

  if (secrets.length === 0) {
    return false;
  }

  return secrets.some((secret) => timingSafeEqual(secret, provided));
}

/** Constant-time compare, so a wrong secret cannot be guessed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}

function parseDays(request: NextRequest) {
  const raw = Number.parseInt(request.nextUrl.searchParams.get("days") ?? "7", 10);

  if (Number.isNaN(raw)) {
    return 7;
  }

  return Math.min(MAX_REPORT_DAYS, Math.max(1, raw));
}

function parseThreshold(value: string | undefined, fallback: number) {
  const parsed = Number.parseFloat(value ?? "");

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadUsageRows(sinceIso: string): Promise<AiUsageRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  const rows: AiUsageRow[] = [];

  for (let from = 0; rows.length < MAX_USAGE_ROWS; from += USAGE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("ai_usage_events")
      .select(
        "created_at, model, stage, success, estimated_cost_usd, lecture_id, error_code, error_message",
      )
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .range(from, from + USAGE_PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    rows.push(...((data ?? []) as AiUsageRow[]));

    if (!data || data.length < USAGE_PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

/**
 * Outcome rows for every artifact kind. Each table is small (tens of rows a day), so the four
 * loads run together and the counting happens in JS -- one paged read per table beats a count
 * query per kind per status per day.
 */
async function loadGenerationRows(sinceIso: string): Promise<GenerationRow[]> {
  const supabase = createSupabaseServiceRoleClient();

  const perSource = await Promise.all(
    GENERATION_SOURCES.map(async ({ kind, table, timestampColumn }) => {
      const rows: GenerationRow[] = [];

      for (let from = 0; rows.length < MAX_GENERATION_ROWS; from += USAGE_PAGE_SIZE) {
        const { data, error } = await supabase
          .from(table)
          .select(`${timestampColumn}, status, error_message`)
          .gte(timestampColumn, sinceIso)
          .order(timestampColumn, { ascending: true })
          .range(from, from + USAGE_PAGE_SIZE - 1);

        if (error) {
          throw error;
        }

        const page = (data ?? []) as unknown as Array<Record<string, unknown>>;

        rows.push(
          ...page.map((row) => ({
            kind,
            settled_at: String(row[timestampColumn]),
            status: String(row.status ?? ""),
            error_message: (row.error_message as string | null) ?? null,
          })),
        );

        if (page.length < USAGE_PAGE_SIZE) {
          break;
        }
      }

      return rows;
    }),
  );

  return perSource.flat();
}

/**
 * OpenRouter's own meter, so the report carries the gateway's real billed figure next to our
 * estimate. Fail-open: the gateway being down must not take the report down.
 */
async function fetchOpenRouterCredits() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as {
      data?: { total_credits?: number; total_usage?: number };
    };

    if (!body.data) {
      return null;
    }

    return {
      totalCreditsUsd: body.data.total_credits ?? null,
      totalUsageUsd: body.data.total_usage ?? null,
      remainingUsd:
        body.data.total_credits != null && body.data.total_usage != null
          ? Math.round((body.data.total_credits - body.data.total_usage) * 100) / 100
          : null,
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const days = parseDays(request);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - days);

  try {
    const [rows, generationRows, openRouterAccount] = await Promise.all([
      loadUsageRows(since.toISOString()),
      loadGenerationRows(since.toISOString()),
      fetchOpenRouterCredits(),
    ]);
    const summary = summarizeAiUsageByDay(rows);
    const generationSummary = summarizeGenerationByDay(generationRows);

    const yesterdayDate = new Date();
    yesterdayDate.setUTCHours(0, 0, 0, 0);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterdayKey = yesterdayDate.toISOString().slice(0, 10);
    const yesterday = summary.find((day) => day.date === yesterdayKey) ?? null;
    const generationYesterday =
      generationSummary.find((day) => day.date === yesterdayKey) ?? null;

    const limits = {
      dailyAlertUsd: parseThreshold(
        process.env.AI_COST_ALERT_DAILY_USD,
        DEFAULT_DAILY_ALERT_USD,
      ),
      lectureAlertUsd: parseThreshold(
        process.env.AI_COST_ALERT_LECTURE_USD,
        DEFAULT_LECTURE_ALERT_USD,
      ),
    };
    const anomalies = yesterday ? findCostAnomalies(yesterday, limits) : [];

    // The anomaly rides the same Sentry -> email path a failed lecture takes. One line per run
    // in the platform log either way, so the cron's own history is auditable in Vercel logs.
    if (anomalies.length > 0) {
      console.error("[ai-cost-report] Spend anomaly", { yesterday, anomalies });
      captureRouteError(
        new Error(`AI spend anomaly: ${anomalies.map((anomaly) => anomaly.message).join(" ")}`),
        {
          route: "cron:ai-cost-report",
          operation: "dailySpendCheck",
          extra: { yesterday, limits },
        },
      );
    } else {
      console.log("[ai-cost-report] Daily spend OK", {
        yesterday: yesterday ?? "no usage",
        generation: generationYesterday?.totals ?? "no generations",
      });
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      days,
      limits,
      yesterday,
      anomalies,
      openRouterAccount,
      daily: summary,
      generation: {
        yesterday: generationYesterday,
        daily: generationSummary,
      },
    });
  } catch (error) {
    captureRouteError(error, {
      route: "cron:ai-cost-report",
      operation: "buildReport",
      request,
    });

    return NextResponse.json({ error: "Report failed." }, { status: 500 });
  }
}
