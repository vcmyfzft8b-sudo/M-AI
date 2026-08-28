// Kept free of "server-only" so the aggregation contract stays unit-testable
// (tests/ai-cost-report.test.mjs) outside the Next.js runtime.

/**
 * Daily AI-spend summary over `ai_usage_events`, split by who actually bills the call: rows
 * whose model carries the "or/" gateway prefix are paid on OpenRouter's meter, everything else
 * on Google's. The numbers are the app's own estimates (usage-logging.ts prices per attempt),
 * which the 2026-08-25 investigation showed track the provider consoles closely — close enough
 * to watch the trend and catch a runaway day, which is this report's whole job.
 */

export type AiUsageRow = {
  created_at: string;
  model: string;
  stage: string;
  success: boolean;
  estimated_cost_usd: number | null;
  lecture_id: string | null;
  error_code: string | null;
  error_message: string | null;
};

export type DailyCostSummary = {
  date: string;
  totalUsd: number;
  googleUsd: number;
  openRouterUsd: number;
  calls: number;
  failedCalls: number;
  topStages: Array<{ stage: string; usd: number; calls: number }>;
  topLectures: Array<{ lectureId: string; usd: number; calls: number }>;
  /** Why the day's failed model calls failed, worst group first. */
  topCallFailures: CallFailureGroup[];
};

/** A group of failed model calls that share a stage and a root cause. */
export type CallFailureGroup = {
  stage: string;
  reason: string;
  count: number;
};

const TOP_STAGES = 5;
const TOP_LECTURES = 3;
const TOP_CALL_FAILURES = 5;
const TOP_GENERATION_FAILURES = 5;
/** Long enough to keep a reason recognisable, short enough to stay one line in the report. */
const REASON_MAX_CHARS = 160;

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

export function isOpenRouterBilledModel(model: string) {
  return model.toLowerCase().startsWith("or/");
}

/**
 * Collapses the parts of an error message that vary between two occurrences of the same fault —
 * ids, array indices, byte counts — so "questions.0.explanation: Too big" and
 * "questions.1.explanation: Too big" land in one group instead of two. The key is for grouping
 * only; the report shows the most common raw message of the group, which stays readable.
 */
export function failureReasonKey(message: string | null | undefined): string {
  const text = (message ?? "").trim();

  if (!text) {
    return "(no message)";
  }

  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, REASON_MAX_CHARS);
}

function truncateReason(message: string | null | undefined): string {
  const text = (message ?? "").replace(/\s+/g, " ").trim();

  if (!text) {
    return "(no message)";
  }

  return text.length > REASON_MAX_CHARS ? `${text.slice(0, REASON_MAX_CHARS - 1)}\u2026` : text;
}

/**
 * Groups failures by {@link failureReasonKey} but labels each group with the raw message seen
 * most often in it, so the caller gets a stable count next to text a human can act on.
 */
function groupFailureReasons(
  failures: Array<{ message: string | null }>,
): Array<{ reason: string; count: number }> {
  const groups = new Map<string, { count: number; labels: Map<string, number> }>();

  for (const failure of failures) {
    const key = failureReasonKey(failure.message);
    const group = groups.get(key) ?? { count: 0, labels: new Map<string, number>() };
    const label = truncateReason(failure.message);

    group.count += 1;
    group.labels.set(label, (group.labels.get(label) ?? 0) + 1);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      reason: [...group.labels.entries()].sort((left, right) => right[1] - left[1])[0][0],
      count: group.count,
    }))
    .sort((left, right) => right.count - left.count);
}

export function summarizeAiUsageByDay(rows: AiUsageRow[]): DailyCostSummary[] {
  const byDay = new Map<
    string,
    {
      totalUsd: number;
      googleUsd: number;
      openRouterUsd: number;
      calls: number;
      failedCalls: number;
      stages: Map<string, { usd: number; calls: number }>;
      lectures: Map<string, { usd: number; calls: number }>;
      callFailures: Map<string, Array<{ message: string | null }>>;
    }
  >();

  for (const row of rows) {
    const date = row.created_at.slice(0, 10);
    const usd = row.estimated_cost_usd ?? 0;
    let day = byDay.get(date);

    if (!day) {
      day = {
        totalUsd: 0,
        googleUsd: 0,
        openRouterUsd: 0,
        calls: 0,
        failedCalls: 0,
        stages: new Map(),
        lectures: new Map(),
        callFailures: new Map(),
      };
      byDay.set(date, day);
    }

    day.totalUsd += usd;
    day.calls += 1;

    if (!row.success) {
      day.failedCalls += 1;

      // error_code is the provider's own label ("503", "RESOURCE_EXHAUSTED"); it makes an
      // otherwise generic message tell you which fault you are looking at.
      const stageFailures = day.callFailures.get(row.stage) ?? [];
      stageFailures.push({
        message: row.error_code
          ? `${row.error_code}: ${row.error_message ?? ""}`.trim().replace(/:$/, "")
          : row.error_message,
      });
      day.callFailures.set(row.stage, stageFailures);
    }

    if (isOpenRouterBilledModel(row.model)) {
      day.openRouterUsd += usd;
    } else {
      day.googleUsd += usd;
    }

    const stage = day.stages.get(row.stage) ?? { usd: 0, calls: 0 };
    stage.usd += usd;
    stage.calls += 1;
    day.stages.set(row.stage, stage);

    if (row.lecture_id) {
      const lecture = day.lectures.get(row.lecture_id) ?? { usd: 0, calls: 0 };
      lecture.usd += usd;
      lecture.calls += 1;
      day.lectures.set(row.lecture_id, lecture);
    }
  }

  return [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, day]) => ({
      date,
      totalUsd: round(day.totalUsd),
      googleUsd: round(day.googleUsd),
      openRouterUsd: round(day.openRouterUsd),
      calls: day.calls,
      failedCalls: day.failedCalls,
      topStages: [...day.stages.entries()]
        .map(([stage, value]) => ({ stage, usd: round(value.usd), calls: value.calls }))
        .sort((left, right) => right.usd - left.usd)
        .slice(0, TOP_STAGES),
      topLectures: [...day.lectures.entries()]
        .map(([lectureId, value]) => ({ lectureId, usd: round(value.usd), calls: value.calls }))
        .sort((left, right) => right.usd - left.usd)
        .slice(0, TOP_LECTURES),
      topCallFailures: [...day.callFailures.entries()]
        .flatMap(([stage, failures]) =>
          groupFailureReasons(failures).map((group) => ({ stage, ...group })),
        )
        .sort((left, right) => right.count - left.count)
        .slice(0, TOP_CALL_FAILURES),
    }));
}

export type CostAnomaly = { kind: "daily_total" | "single_lecture"; message: string };

/**
 * The alarm thresholds sit far above the healthy baseline (~$0.5–2/day, worst measured single
 * lecture $0.40) and far below the 2026-08-25 incident ($19.63): tripping one means something is
 * looping again, not that the product had a good day.
 */
export const DEFAULT_DAILY_ALERT_USD = 10;
export const DEFAULT_LECTURE_ALERT_USD = 1.5;

export function findCostAnomalies(
  day: DailyCostSummary,
  limits?: { dailyAlertUsd?: number; lectureAlertUsd?: number },
): CostAnomaly[] {
  const dailyLimit = limits?.dailyAlertUsd ?? DEFAULT_DAILY_ALERT_USD;
  const lectureLimit = limits?.lectureAlertUsd ?? DEFAULT_LECTURE_ALERT_USD;
  const anomalies: CostAnomaly[] = [];

  if (day.totalUsd >= dailyLimit) {
    anomalies.push({
      kind: "daily_total",
      message: `AI spend on ${day.date} was $${day.totalUsd.toFixed(2)} (limit $${dailyLimit}): Google $${day.googleUsd.toFixed(2)}, OpenRouter $${day.openRouterUsd.toFixed(2)}, ${day.calls} calls.`,
    });
  }

  for (const lecture of day.topLectures) {
    if (lecture.usd >= lectureLimit) {
      anomalies.push({
        kind: "single_lecture",
        message: `Lecture ${lecture.lectureId} spent $${lecture.usd.toFixed(2)} on ${day.date} across ${lecture.calls} calls (limit $${lectureLimit}).`,
      });
    }
  }

  return anomalies;
}

/**
 * What the spend actually produced. The cost half of this report answers "how much did we pay";
 * this half answers "how many notes, flashcard decks, quizzes and practice tests came out, and
 * how many of them broke" — the two numbers only mean something next to each other.
 *
 * One row per artifact per lecture, because that is how the tables are keyed: the three study
 * tables are `lecture_id`-primary and are re-stamped in place on every regeneration, so a day's
 * count is "generation attempts that settled that day", not "distinct lectures ever generated".
 */
export const GENERATION_KINDS = ["notes", "flashcards", "quizzes", "practiceTests"] as const;

export type GenerationKind = (typeof GENERATION_KINDS)[number];

export type GenerationRow = {
  kind: GenerationKind;
  /** Day bucket: when the attempt settled (study assets) or when the lecture was created (notes). */
  settled_at: string;
  /** Raw table status: 'ready' | 'failed' | anything else still in flight. */
  status: string;
  error_message: string | null;
};

export type GenerationOutcome = {
  total: number;
  succeeded: number;
  failed: number;
  /** Still queued, generating, or (for notes) uploading when the report ran. */
  pending: number;
};

export type DailyGenerationSummary = {
  date: string;
  totals: GenerationOutcome;
  kinds: Record<GenerationKind, GenerationOutcome>;
  failureReasons: Array<{ kind: GenerationKind; reason: string; count: number }>;
};

function emptyOutcome(): GenerationOutcome {
  return { total: 0, succeeded: 0, failed: 0, pending: 0 };
}

function emptyKinds(): Record<GenerationKind, GenerationOutcome> {
  return Object.fromEntries(GENERATION_KINDS.map((kind) => [kind, emptyOutcome()])) as Record<
    GenerationKind,
    GenerationOutcome
  >;
}

/**
 * 'ready' and 'failed' are the only terminal states the four tables share. Everything else
 * ('queued', 'generating', and the lecture pipeline's 'uploading'/'transcribing'/'generating_notes')
 * is counted as pending rather than as a failure — a lecture uploaded at 23:59 is not a defect.
 */
function classify(status: string): keyof Omit<GenerationOutcome, "total"> {
  if (status === "ready") {
    return "succeeded";
  }

  return status === "failed" ? "failed" : "pending";
}

export function summarizeGenerationByDay(rows: GenerationRow[]): DailyGenerationSummary[] {
  const byDay = new Map<
    string,
    {
      totals: GenerationOutcome;
      kinds: Record<GenerationKind, GenerationOutcome>;
      failures: Map<GenerationKind, Array<{ message: string | null }>>;
    }
  >();

  for (const row of rows) {
    const date = row.settled_at.slice(0, 10);
    let day = byDay.get(date);

    if (!day) {
      day = { totals: emptyOutcome(), kinds: emptyKinds(), failures: new Map() };
      byDay.set(date, day);
    }

    const bucket = classify(row.status);

    day.totals.total += 1;
    day.totals[bucket] += 1;
    day.kinds[row.kind].total += 1;
    day.kinds[row.kind][bucket] += 1;

    if (bucket === "failed") {
      const failures = day.failures.get(row.kind) ?? [];
      failures.push({ message: row.error_message });
      day.failures.set(row.kind, failures);
    }
  }

  return [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, day]) => ({
      date,
      totals: day.totals,
      kinds: day.kinds,
      failureReasons: [...day.failures.entries()]
        .flatMap(([kind, failures]) =>
          groupFailureReasons(failures).map((group) => ({ kind, ...group })),
        )
        .sort((left, right) => right.count - left.count)
        .slice(0, TOP_GENERATION_FAILURES),
    }));
}
