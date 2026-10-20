import { NextResponse, type NextRequest } from "next/server";

import { FALLBACK_EUR_PER_USD } from "@/lib/admin/costs-math";
import { callRpc } from "@/lib/admin/db";
import {
  assessMonthlyCap,
  billingMonth,
  findCapAnomalies,
  findCostAnomalies,
  isOpenRouterBilledModel,
  parseSonioxUsageSummary,
  summarizeAiUsageDays,
  summarizeGenerationByDay,
  CAP_WARN_SHARE,
  DEFAULT_DAILY_ALERT_USD,
  DEFAULT_GEMINI_MONTHLY_SPEND_CAP_EUR,
  DEFAULT_GEMINI_SPEND_METER_FACTOR,
  DEFAULT_LECTURE_ALERT_USD,
  GEMINI_SPEND_CAP_TIME_ZONE,
  SONIOX_BUDGET_TIME_ZONE,
  type AiUsageWindow,
  type CostAnomaly,
  type GenerationKind,
  type GenerationRow,
  type MonthlyCapStatus,
  type SonioxDayUsage,
} from "@/lib/ai-cost-report";
import { captureRouteError } from "@/lib/monitoring";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Daily AI-spend report over `ai_usage_events` plus Soniox's own usage meter, split by billing
 * source (Google direct, the OpenRouter gateway, Soniox speech) — the watch the 2026-08-25 cost
 * spike earned. Two consumers:
 *
 * - Vercel Cron calls it every morning (vercel.json). When yesterday crossed an alarm threshold
 *   it reports the anomaly to Sentry, which the "new production issue" alert turns into an
 *   email within seconds — the same proven path a failed lecture takes. Repeated anomaly days
 *   group into one Sentry issue; resolving that issue re-arms the email for the next one.
 *   The monthly spending caps (Gemini's, and Soniox's budget when set) are checked on the same
 *   run and warn as their own issue, one per provider per month, so an open daily-spend issue can
 *   never swallow a cap warning.
 * - The scheduled morning-summary agent fetches it read-only for the daily numbers.
 *
 * Every day is read as one SQL aggregate (migration 0072). A day that cannot be read is listed in
 * `coverage.missingDays` and left out of `daily`; when it is yesterday or part of the cap's month,
 * that is an alarm of its own, because a silent $0 is how the 2026-10-20 cap went unannounced.
 *
 * Auth accepts the shared cron secrets plus AI_COST_REPORT_SECRET, a dedicated secret that
 * unlocks only this read-only endpoint, so the summary consumer never has to hold a secret
 * that can trigger paid work elsewhere.
 */

const MAX_REPORT_DAYS = 30;
const GENERATION_PAGE_SIZE = 1000;
/**
 * Artifact rows run ~50/day per kind, so this is a runaway guard, not a real ceiling. They are read
 * newest first, so if it is ever reached it is the oldest days that go, and the response says so.
 */
const MAX_GENERATION_ROWS = 20_000;
/** Complete days the spend pace (and so the month-end forecast) is measured over. */
const PACE_DAYS = 7;
/** Day aggregates read at once: a month in a few seconds without crowding the database. */
const DAY_READ_CONCURRENCY = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function utcDayStart(date: Date) {
  return new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** An optional positive amount from the environment; null when unset or not a positive number. */
function parseOptionalAmount(value: string | undefined) {
  const parsed = Number.parseFloat(value ?? "");

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isUsageWindow(value: unknown): value is AiUsageWindow {
  const candidate = value as Partial<AiUsageWindow> | null;

  return (
    Array.isArray(candidate?.groups) &&
    Array.isArray(candidate?.lectures) &&
    Array.isArray(candidate?.failures)
  );
}

/**
 * One window of `ai_usage_events`, aggregated in SQL. Asked twice before giving up. `totalsOnly`
 * skips the lecture and failure lists, for days read only for their cost (the rest of the cap
 * month and the pace week).
 */
async function loadUsageWindow(
  fromIso: string,
  toIso: string,
  totalsOnly: boolean,
): Promise<AiUsageWindow> {
  const supabase = createSupabaseServiceRoleClient();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await callRpc(supabase, "ai_cost_report_window", {
      p_from: fromIso,
      p_to: toIso,
      ...(totalsOnly ? { p_top_lectures: 0, p_max_failure_groups: 0 } : {}),
    });

    if (!error && isUsageWindow(data)) {
      return data;
    }

    lastError = new Error(
      error?.message ?? "ai_cost_report_window answered with an unexpected shape",
    );
  }

  throw lastError;
}

/** What Google billed directly in a window: every call not routed through the gateway. */
function googleUsdOf(window: AiUsageWindow) {
  return window.groups
    .filter((group) => !isOpenRouterBilledModel(group.model))
    .reduce((sum, group) => sum + (Number(group.cost_usd) || 0), 0);
}

/** Runs `work` over `items`, at most `limit` at a time, keeping each item's own outcome. */
async function settleEach<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;

        try {
          results[index] = { status: "fulfilled", value: await work(items[index]) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );

  return results;
}

/**
 * Outcome rows for every artifact kind. Each table is small (tens of rows a day), so the four
 * loads run together and the counting happens in JS -- one paged read per table beats a count
 * query per kind per status per day.
 */
async function loadGenerationRows(
  sinceIso: string,
): Promise<{ rows: GenerationRow[]; truncatedThrough: string | null }> {
  const supabase = createSupabaseServiceRoleClient();

  const perSource = await Promise.all(
    GENERATION_SOURCES.map(async ({ kind, table, timestampColumn }) => {
      const rows: GenerationRow[] = [];

      for (let from = 0; rows.length < MAX_GENERATION_ROWS; from += GENERATION_PAGE_SIZE) {
        const { data, error } = await supabase
          .from(table)
          .select(`${timestampColumn}, status, error_message`)
          .gte(timestampColumn, sinceIso)
          .order(timestampColumn, { ascending: false })
          .range(from, from + GENERATION_PAGE_SIZE - 1);

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

        if (page.length < GENERATION_PAGE_SIZE) {
          return { rows, truncatedThrough: null };
        }
      }

      // Newest first, so only the oldest day read (and any before it) can be short.
      return { rows, truncatedThrough: rows.at(-1)?.settled_at.slice(0, 10) ?? null };
    }),
  );

  const truncated = perSource
    .map((source) => source.truncatedThrough)
    .filter((day): day is string => Boolean(day))
    .sort();

  return { rows: perSource.flatMap((source) => source.rows), truncatedThrough: truncated.at(-1) ?? null };
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

/**
 * Soniox's own meter, per UTC day and model, for the report window. Speech never reaches
 * `ai_usage_events` (the tutor's sockets run from the browser on a temporary key), so this is the
 * only place it is counted. Fail-open like the OpenRouter read: null means "unavailable", and the
 * report says so instead of showing speech as free.
 */
async function fetchSonioxUsage(sinceIso: string, untilIso: string) {
  const apiKey = process.env.SONIOX_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  try {
    const query = new URLSearchParams({ start_time: sinceIso, end_time: untilIso });
    const response = await fetch(`https://api.soniox.com/v1/usage/summary?${query}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return null;
    }

    return parseSonioxUsageSummary(await response.json());
  } catch {
    return null;
  }
}

/**
 * The day's dollar-to-euro rate (ECB, via Frankfurter, as /admin/costs reads it), for comparing
 * dollar spend with the euro Gemini cap. Fail-open to a fixed rate: a cap check a percent off
 * beats no cap check.
 */
async function fetchEurPerUsd() {
  try {
    const response = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR", {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });

    if (response.ok) {
      const body = (await response.json()) as { date?: string; rates?: { EUR?: number } };
      const rate = Number(body.rates?.EUR);

      if (Number.isFinite(rate) && rate > 0) {
        return { rate, source: "ecb" as const, date: body.date ?? null };
      }
    }
  } catch {
    // Fall through to the fixed rate.
  }

  return { rate: FALLBACK_EUR_PER_USD, source: "fallback" as const, date: null };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const days = parseDays(request);
  const now = new Date();
  const today = utcDayStart(now);
  const reportStart = addDays(today, -days);
  const googleMonth = billingMonth(now, GEMINI_SPEND_CAP_TIME_ZONE);
  const sonioxMonth = billingMonth(now, SONIOX_BUDGET_TIME_ZONE);
  const googleMonthStart = new Date(googleMonth.startIso);
  const firstDay = new Date(
    Math.min(
      reportStart.getTime(),
      utcDayStart(googleMonthStart).getTime(),
      Date.parse(sonioxMonth.startIso),
      addDays(today, -PACE_DAYS).getTime(),
    ),
  );

  const sonioxFirstDay = new Date(
    Math.min(
      reportStart.getTime(),
      Date.parse(sonioxMonth.startIso),
      addDays(today, -PACE_DAYS).getTime(),
    ),
  );

  // Every UTC day from the oldest one any figure needs, today (still running) last.
  const dayStarts: Date[] = [];

  for (let day = firstDay; day.getTime() <= today.getTime(); day = addDays(day, 1)) {
    dayStarts.push(day);
  }

  // Google's month starts at Pacific midnight, part-way through a UTC day; that part is read on
  // its own so the month-to-date figure neither drops it nor counts the previous month's evening.
  const monthHeadKey = `gemini-month-start:${googleMonth.startIso}`;
  const windows = [
    ...dayStarts.map((day) => ({ key: dayKey(day), from: day, to: addDays(day, 1) })),
    ...(googleMonthStart.getTime() === utcDayStart(googleMonthStart).getTime()
      ? []
      : [{ key: monthHeadKey, from: googleMonthStart, to: addDays(utcDayStart(googleMonthStart), 1) }]),
  ];

  try {
    const [loaded, generationLoad, openRouterAccount, sonioxUsage, eurPerUsd] = await Promise.all([
      settleEach(windows, DAY_READ_CONCURRENCY, (window) =>
        loadUsageWindow(
          window.from.toISOString(),
          window.to.toISOString(),
          window.from.getTime() < reportStart.getTime() || window.key === monthHeadKey,
        ),
      ),
      loadGenerationRows(reportStart.toISOString()),
      fetchOpenRouterCredits(),
      // Soniox needs only its own (UTC) month and the pace week, not Google's Pacific month: at
      // 04:15 UTC on the 1st that would ask Soniox for 32 days.
      fetchSonioxUsage(sonioxFirstDay.toISOString(), now.toISOString()),
      fetchEurPerUsd(),
    ]);

    const usageByDay = new Map<string, AiUsageWindow>();
    const missing: string[] = [];

    windows.forEach((window, index) => {
      const result = loaded[index];

      if (result.status === "fulfilled") {
        usageByDay.set(window.key, result.value);
      } else {
        missing.push(window.key);
        console.error("[ai-cost-report] Could not read a day of usage", {
          window: window.key,
          error: result.reason,
        });
      }
    });

    const missingSet = new Set(missing);
    const reportDays = dayStarts
      .filter((day) => day.getTime() >= reportStart.getTime())
      .map(dayKey)
      // A day that could not be read is left out whole, Soniox included: a summary of it would
      // read as a day with no model calls.
      .filter((key) => !missingSet.has(key));
    const summary = summarizeAiUsageDays(
      Object.fromEntries(reportDays.map((key) => [key, usageByDay.get(key) as AiUsageWindow])),
      sonioxUsage
        ? Object.fromEntries(
            reportDays
              .filter((key) => sonioxUsage[key])
              .map((key) => [key, sonioxUsage[key] as SonioxDayUsage]),
          )
        : null,
    );
    const generationSummary = summarizeGenerationByDay(generationLoad.rows).filter(
      (day) => !generationLoad.truncatedThrough || day.date > generationLoad.truncatedThrough,
    );

    const yesterdayKey = dayKey(addDays(today, -1));
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
      geminiMonthlySpendCapEur: parseThreshold(
        process.env.GEMINI_MONTHLY_SPEND_CAP_EUR,
        DEFAULT_GEMINI_MONTHLY_SPEND_CAP_EUR,
      ),
      geminiSpendMeterFactor: Math.max(
        1,
        parseThreshold(process.env.GEMINI_SPEND_METER_FACTOR, DEFAULT_GEMINI_SPEND_METER_FACTOR),
      ),
      sonioxMonthlyBudgetUsd: parseOptionalAmount(process.env.SONIOX_MONTHLY_BUDGET_USD),
      capWarnShare: CAP_WARN_SHARE,
    };
    const sonioxAvailable = sonioxUsage != null;
    const anomalies = yesterday
      ? findCostAnomalies(yesterday, limits, { sonioxAvailable })
      : [];

    // --- The monthly caps. Pace is measured over the last complete days that could be read.
    const completeDays = dayStarts.filter((day) => day.getTime() < today.getTime()).slice(-PACE_DAYS);
    const googleMonthDays = dayStarts.filter(
      (day) => day.getTime() >= googleMonthStart.getTime(),
    );
    const googleMonthKeys = [
      ...(windows.some((window) => window.key === monthHeadKey) ? [monthHeadKey] : []),
      ...googleMonthDays.map(dayKey),
    ];
    const googleCap = assessMonthlyCap({
      provider: "google",
      month: googleMonth,
      now,
      cap: limits.geminiMonthlySpendCapEur,
      currency: "EUR",
      capCurrencyPerUsd: eurPerUsd.rate,
      meterFactor: limits.geminiSpendMeterFactor,
      spentUsd: googleMonthKeys.reduce((sum, key) => {
        const window = usageByDay.get(key);
        return window ? sum + googleUsdOf(window) : sum;
      }, 0),
      recentDailyUsd: completeDays
        .map((day) => usageByDay.get(dayKey(day)))
        .filter((window): window is AiUsageWindow => Boolean(window))
        .map(googleUsdOf),
      complete: googleMonthKeys.every((key) => !missingSet.has(key)),
    });

    let sonioxCap: MonthlyCapStatus | null = null;

    if (limits.sonioxMonthlyBudgetUsd != null && sonioxUsage) {
      const monthStartKey = sonioxMonth.startIso.slice(0, 10);

      sonioxCap = assessMonthlyCap({
        provider: "soniox",
        month: sonioxMonth,
        now,
        cap: limits.sonioxMonthlyBudgetUsd,
        currency: "USD",
        capCurrencyPerUsd: 1,
        spentUsd: Object.entries(sonioxUsage)
          .filter(([key]) => key >= monthStartKey)
          .reduce((sum, [, usage]) => sum + usage.usd, 0),
        recentDailyUsd: completeDays.map((day) => sonioxUsage[dayKey(day)]?.usd ?? 0),
        complete: true,
      });
    }

    const capAnomalies = [googleCap, sonioxCap]
      .filter((status): status is MonthlyCapStatus => status != null)
      .map((status) => ({ status, anomalies: findCapAnomalies(status) }))
      .filter((entry) => entry.anomalies.length > 0);

    // --- What could not be checked is said out loud, never shown as a quiet $0.
    const coverageGaps: string[] = [];

    if (missingSet.has(yesterdayKey)) {
      coverageGaps.push(`yesterday (${yesterdayKey}) could not be read, so its spend alarms were not checked`);
    }

    if (!googleCap.complete) {
      const gaps = googleMonthKeys.filter((key) => missingSet.has(key) && key !== yesterdayKey);

      if (gaps.length > 0) {
        coverageGaps.push(
          `${gaps.join(", ")} could not be read, so the Gemini cap figure for ${googleMonth.key} is a floor`,
        );
      }
    }

    if (limits.sonioxMonthlyBudgetUsd != null && !sonioxUsage) {
      coverageGaps.push(
        `Soniox's usage summary could not be read, so its $${limits.sonioxMonthlyBudgetUsd} monthly budget was not checked`,
      );
    }

    const coverageAnomalies: CostAnomaly[] =
      coverageGaps.length > 0
        ? [{ kind: "report_incomplete", message: `AI cost report incomplete: ${coverageGaps.join("; ")}.` }]
        : [];

    // The anomaly rides the same Sentry -> email path a failed lecture takes. One line per run
    // in the platform log either way, so the cron's own history is auditable in Vercel logs.
    if (anomalies.length > 0) {
      console.error("[ai-cost-report] Spend anomaly", { yesterday, anomalies });
      captureRouteError(
        new Error(`AI spend anomaly: ${anomalies.map((anomaly) => anomaly.message).join(" ")}`),
        {
          route: "cron:ai-cost-report",
          operation: "dailySpendCheck",
          extra: { yesterday, limits, sonioxAvailable },
        },
      );
    }

    for (const { status, anomalies: warnings } of capAnomalies) {
      console.error("[ai-cost-report] Monthly cap warning", { status, warnings });
      // One issue per provider per month: the first warning of a month always emails, and the
      // ones after it that month group under it instead of emailing every morning.
      captureRouteError(
        new Error(`AI spend cap warning: ${warnings.map((warning) => warning.message).join(" ")}`),
        {
          route: "cron:ai-cost-report",
          operation: "monthlyCapCheck",
          tags: { provider: status.provider },
          fingerprint: ["ai-cost-report", "monthly-cap", status.provider, status.month.key],
          extra: { status },
        },
      );
    }

    if (coverageAnomalies.length > 0) {
      console.error("[ai-cost-report] Report incomplete", { missing });
      // Its own issue per month, like the caps: an old unresolved one must not swallow a new gap.
      captureRouteError(new Error(coverageAnomalies[0].message), {
        route: "cron:ai-cost-report",
        operation: "reportCoverage",
        fingerprint: ["ai-cost-report", "report-incomplete", googleMonth.key],
        extra: { missing, sonioxAvailable },
      });
    }

    if (anomalies.length === 0 && capAnomalies.length === 0 && coverageAnomalies.length === 0) {
      console.log("[ai-cost-report] Daily spend OK", {
        yesterday: yesterday ?? "no usage",
        sonioxAvailable,
        googleCap: { spent: googleCap.spent, cap: googleCap.cap, forecast: googleCap.forecast },
        generation: generationYesterday?.totals ?? "no generations",
      });
    }

    return NextResponse.json({
      generatedAt: now.toISOString(),
      days,
      limits,
      yesterday,
      anomalies: [
        ...anomalies,
        ...capAnomalies.flatMap((entry) => entry.anomalies),
        ...coverageAnomalies,
      ],
      // Month-to-date against each provider's own limit. Google's is our call log scaled by
      // geminiSpendMeterFactor to what Google's cap meter reads (loggedUsd is the raw log);
      // soniox is null unless SONIOX_MONTHLY_BUDGET_USD is set.
      caps: { google: googleCap, soniox: sonioxCap },
      eurPerUsd,
      // Days that could not be read are listed here and left out of `daily`, never shown as $0.
      coverage: {
        complete: missing.length === 0,
        missingDays: missing,
      },
      openRouterAccount,
      // False means the daily totals are missing speech, not that speech cost nothing.
      sonioxAvailable,
      daily: summary,
      generation: {
        yesterday: generationYesterday,
        daily: generationSummary,
        // Set only if the runaway guard cut the read: days up to and including it are left out.
        truncatedThrough: generationLoad.truncatedThrough,
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
