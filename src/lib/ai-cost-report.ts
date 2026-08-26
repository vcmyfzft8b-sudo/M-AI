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
};

const TOP_STAGES = 5;
const TOP_LECTURES = 3;

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

export function isOpenRouterBilledModel(model: string) {
  return model.toLowerCase().startsWith("or/");
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
      };
      byDay.set(date, day);
    }

    day.totalUsd += usd;
    day.calls += 1;

    if (!row.success) {
      day.failedCalls += 1;
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
