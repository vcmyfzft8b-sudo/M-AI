// Kept free of "server-only" so the aggregation contract stays unit-testable
// (tests/ai-cost-report.test.mjs) outside the Next.js runtime.

/**
 * Daily AI-spend summary, split by who actually bills the call: rows of `ai_usage_events` whose
 * model carries the "or/" gateway prefix are paid on OpenRouter's meter, the rest on Google's,
 * and speech (read-aloud TTS, lecture transcription, the tutor's live STT) on Soniox's.
 *
 * Routed calls carry the gateway's own billed figure; direct Gemini calls are priced from
 * model-prices.ts. Soniox is never written to the usage log — the tutor's sockets run from the
 * learner's browser on a temporary key, so no server sees what they used — and comes from
 * Soniox's own usage summary instead, which is per day and per model already.
 *
 * Until 2026-10-02 the log missed a large share of September's ~$73 OpenRouter bill and all of
 * the $42.63 Soniox one: an unpriced model, two stale prices, and no speech at all.
 * `unpricedCalls` exists so that kind of gap shows up in the next morning's report.
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
  /** Read only to tell an unpriced call (tokens, no cost) from one that never got a reply. */
  prompt_token_count?: number | null;
};

/** One day of Soniox's own meter: what it billed, and for which model. */
export type SonioxDayUsage = {
  usd: number;
  models: Array<{ model: string; usd: number }>;
};

export type DailyCostSummary = {
  date: string;
  /** Everything billed that day: Google + OpenRouter + Soniox. */
  totalUsd: number;
  googleUsd: number;
  openRouterUsd: number;
  /** Speech on Soniox's meter; 0 when Soniox's summary was unavailable (see the route). */
  sonioxUsd: number;
  sonioxModels: Array<{ model: string; usd: number }>;
  calls: number;
  failedCalls: number;
  topStages: Array<{ stage: string; usd: number; calls: number }>;
  topLectures: Array<{ lectureId: string; usd: number; calls: number }>;
  /** Why the day's failed model calls failed, worst group first. */
  topCallFailures: CallFailureGroup[];
  /** Every failed call of the day sorted into who has to act, not just the printed groups. */
  callFailureCategories: Array<{ category: FailureCategory; count: number }>;
  /**
   * Calls that used tokens but logged no cost: a model missing from model-prices.ts (or set by an
   * env override the price test cannot see). Anything here means the day's total is low.
   */
  unpricedCalls: Array<{ model: string; calls: number }>;
};

/** A group of failed model calls that share a stage and a root cause. */
export type CallFailureGroup = {
  stage: string;
  /** The raw provider/validator message, for whoever is going to debug it. */
  reason: string;
  /** The same thing in one plain sentence, for whoever is only reading the summary. */
  plain: string;
  category: FailureCategory;
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
 * Who has to act on a failure. The morning report leads with this, because "3 of yesterday's 4
 * failures were bad uploads" and "3 of them were our schema" call for very different mornings.
 */
export type FailureCategory = "upload" | "our-code" | "provider" | "unknown";

export type FailureExplanation = {
  /** One sentence, no jargon, safe to paste into a summary as-is. */
  plain: string;
  category: FailureCategory;
};

/**
 * Plain-English readings of the causes actually seen in production (30-day sweep, 2026-08-28:
 * 42 distinct raw causes, of which the entries below cover ~99% of failed calls and every
 * artifact failure). Ordered most specific first -- the first match wins.
 *
 * Anything unmatched falls through to "unknown" and keeps its raw message, so a new fault shows
 * up in the report as itself rather than being silently mislabelled as a known one.
 */
const FAILURE_RULES: Array<{ match: RegExp; plain: string; category: FailureCategory }> = [
  // --- The uploaded material is the problem; the user can fix it by uploading something else.
  // The user-facing copy is Slovenian, so each of these matches both languages -- the report is
  // read in English and "V zvoku ni bilo mogoce..." is not a summary.
  {
    match: /dovolj jasnega govora|no clear speech|not enough clear speech/i,
    plain: "The recording had no clear speech to transcribe.",
    category: "upload",
  },
  {
    // The photo was read and simply held little; distinct from the unreadable-photo rule below,
    // and distinct advice to the learner, so it must not be folded into it.
    match: /premalo besedila za zapiske/i,
    plain: "The photo was read, but held too little text to make notes from.",
    category: "upload",
  },
  {
    // Must precede the page rule: both mention "berljivega besedila", only this one is a photo.
    match: /Na fotografiji ni bilo mogo|readable text.*photo|photo.*readable text/i,
    plain: "The photo had too little readable text.",
    category: "upload",
  },
  {
    match: /Na tej strani ni dovolj berljivega besedila|does not contain enough readable text/i,
    plain: "The linked page had almost no readable text to work from.",
    category: "upload",
  },
  {
    match: /private or requires permission/i,
    plain: "The link was private, so it could not be opened.",
    category: "upload",
  },
  {
    match: /Do spletne strani na tej povezavi ni bilo mogo|could not be reached/i,
    plain: "The linked page could not be reached.",
    category: "upload",
  },
  {
    match: /too large to process at once/i,
    plain: "The upload was too big to process in one piece.",
    category: "upload",
  },
  {
    match: /datoteka je predolga|Omejitev je 3 ure/i,
    plain: "The audio was longer than the 3-hour limit.",
    category: "upload",
  },
  {
    match: /datoteka je prevelika|Omejitev je 300 MB/i,
    plain: "The audio was larger than the 300 MB limit.",
    category: "upload",
  },
  {
    match: /Dokumenta ni bilo mogo|nepodprte binarne podatke/i,
    plain: "The document could not be read; it may need exporting as a PDF first.",
    category: "upload",
  },

  // --- Our own request, schema, or caps; only a code change fixes these.
  {
    match: /too many states for serving/i,
    plain:
      "Our JSON schema was too complex for Gemini to serve, so the request was rejected before the model ran. It costs nothing, but nothing is produced either.",
    category: "our-code",
  },
  {
    match: /TruncatedOutputError|truncated.*output limit/i,
    plain: "The model ran out of its output budget mid-JSON, so the reply could not be parsed.",
    category: "our-code",
  },
  {
    match: /Unsupported MIME type/i,
    plain: "We sent a file type Gemini refuses instead of converting it first.",
    category: "our-code",
  },
  // Two shapes for the same fault: the raw ZodError as logged against a model call, and the
  // unwrapped single issue the study tables store ("questions.0.explanation: Too big: ...").
  {
    match: /"too_big"|Too big: expected/i,
    plain: "The model wrote a field longer than our validator allows.",
    category: "our-code",
  },
  {
    match: /"too_small"|Too small: expected/i,
    plain: "The model left a field shorter than our validator allows, usually empty.",
    category: "our-code",
  },
  {
    match: /ZodError|invalid_type/i,
    plain: "The model's reply did not match the shape our validator expects.",
    category: "our-code",
  },
  {
    match: /SyntaxError|is not valid JSON|Unterminated string|Unexpected end of JSON/i,
    plain: "The model returned malformed JSON.",
    category: "our-code",
  },
  {
    match: /Empty(Text|Structured)?OutputError|returned empty (text|structured) output/i,
    plain: "The model returned nothing at all.",
    category: "our-code",
  },
  {
    match: /timed out after|operation was aborted|aborted due to timeout/i,
    plain: "The call hit our own timeout and was cut off.",
    category: "our-code",
  },
  {
    // The pipeline's stage-budget message, stored in Slovenian on the lecture.
    match: /trajala predolgo|traja predolgo/i,
    plain: "Processing ran past our own time budget and was stopped part-way.",
    category: "our-code",
  },
  {
    match: /API key not valid|PERMISSION_DENIED|caller does not have permission/i,
    plain: "The API key was rejected or is not allowed to call that model -- a config problem.",
    category: "our-code",
  },
  {
    match: /Request contains an invalid argument|INVALID_ARGUMENT/i,
    plain: "Gemini rejected the request as malformed.",
    category: "our-code",
  },

  // --- Gemini/OpenRouter's side. Transient, and the retry usually covers it.
  {
    match: /overloaded|high demand/i,
    plain: "Gemini was overloaded and refused the call.",
    category: "provider",
  },
  {
    match: /service is currently unavailable|UNAVAILABLE|Deadline expired/i,
    plain: "Gemini was temporarily unavailable.",
    category: "provider",
  },
  {
    match: /rate limit|RESOURCE_EXHAUSTED|quota/i,
    plain: "We hit the provider's rate limit or quota.",
    category: "provider",
  },
  {
    match: /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network error/i,
    plain: "The connection to the provider failed outright.",
    category: "provider",
  },
];

/** Plain-English reading of one raw failure message. Never throws; unknown text stays unknown. */
export function explainFailure(message: string | null | undefined): FailureExplanation {
  const text = (message ?? "").trim();

  if (!text) {
    return { plain: "The failure was recorded without a message.", category: "unknown" };
  }

  const rule = FAILURE_RULES.find((candidate) => candidate.match.test(text));

  return rule
    ? { plain: rule.plain, category: rule.category }
    : { plain: truncateReason(text), category: "unknown" };
}

/** Roll-up over every failure of a day, not just the top groups the report prints. */
function countCategories(
  failures: Array<{ message: string | null }>,
): Array<{ category: FailureCategory; count: number }> {
  const counts = new Map<FailureCategory, number>();

  for (const failure of failures) {
    const { category } = explainFailure(failure.message);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count);
}

/**
 * Groups failures by {@link failureReasonKey} but labels each group with the raw message seen
 * most often in it, so the caller gets a stable count next to text a human can act on.
 */
function groupFailureReasons(
  failures: Array<{ message: string | null }>,
): Array<{ reason: string; plain: string; category: FailureCategory; count: number }> {
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
    .map((group) => {
      const reason = [...group.labels.entries()].sort((left, right) => right[1] - left[1])[0][0];

      return { reason, ...explainFailure(reason), count: group.count };
    })
    .sort((left, right) => right.count - left.count);
}

type DayAccumulator = {
  totalUsd: number;
  googleUsd: number;
  openRouterUsd: number;
  sonioxUsd: number;
  sonioxModels: Array<{ model: string; usd: number }>;
  calls: number;
  failedCalls: number;
  stages: Map<string, { usd: number; calls: number }>;
  lectures: Map<string, { usd: number; calls: number }>;
  callFailures: Map<string, Array<{ message: string | null }>>;
  unpriced: Map<string, number>;
};

/**
 * @param soniox Soniox's own per-day meter, keyed by UTC date like the rows. A day with speech
 *   but no model calls still gets a summary.
 */
export function summarizeAiUsageByDay(
  rows: AiUsageRow[],
  soniox?: Record<string, SonioxDayUsage> | null,
): DailyCostSummary[] {
  const byDay = new Map<string, DayAccumulator>();
  const dayFor = (date: string) => {
    let day = byDay.get(date);

    if (!day) {
      day = {
        totalUsd: 0,
        googleUsd: 0,
        openRouterUsd: 0,
        sonioxUsd: 0,
        sonioxModels: [],
        calls: 0,
        failedCalls: 0,
        stages: new Map(),
        lectures: new Map(),
        callFailures: new Map(),
        unpriced: new Map(),
      };
      byDay.set(date, day);
    }

    return day;
  };

  for (const [date, usage] of Object.entries(soniox ?? {})) {
    if (usage.usd <= 0) {
      continue;
    }

    const day = dayFor(date);
    day.sonioxUsd += usage.usd;
    day.totalUsd += usage.usd;
    day.sonioxModels = usage.models;
  }

  for (const row of rows) {
    const date = row.created_at.slice(0, 10);
    const usd = row.estimated_cost_usd ?? 0;
    const day = dayFor(date);

    day.totalUsd += usd;
    day.calls += 1;

    if (row.estimated_cost_usd == null && (row.prompt_token_count ?? 0) > 0) {
      day.unpriced.set(row.model, (day.unpriced.get(row.model) ?? 0) + 1);
    }

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
      sonioxUsd: round(day.sonioxUsd),
      sonioxModels: day.sonioxModels,
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
      callFailureCategories: countCategories([...day.callFailures.values()].flat()),
      unpricedCalls: [...day.unpriced.entries()]
        .map(([model, calls]) => ({ model, calls }))
        .sort((left, right) => right.calls - left.calls),
    }));
}

/**
 * Soniox's `GET /v1/usage/summary` body as per-day spend. It answers one entry per day in the
 * requested window, as parallel arrays (`days[i]` billed `cost_usd[i]`), with costs as decimal
 * strings. Returns null for anything that is not that shape, so a changed API reads as
 * "unavailable" rather than as a free day.
 */
export function parseSonioxUsageSummary(body: unknown): Record<string, SonioxDayUsage> | null {
  type Series = { model?: string | null; days?: unknown; cost_usd?: unknown };
  const summary = body as { total?: Series; models?: Series[] } | null;
  const total = summary?.total;

  if (!total || !Array.isArray(total.days) || !Array.isArray(total.cost_usd)) {
    return null;
  }

  const toUsd = (value: unknown) => {
    const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const byDay: Record<string, SonioxDayUsage> = {};

  total.days.forEach((date, index) => {
    byDay[String(date)] = { usd: round(toUsd((total.cost_usd as unknown[])[index])), models: [] };
  });

  for (const series of summary?.models ?? []) {
    if (!series.model || !Array.isArray(series.days) || !Array.isArray(series.cost_usd)) {
      continue;
    }

    series.days.forEach((date, index) => {
      const usd = round(toUsd((series.cost_usd as unknown[])[index]));
      const day = byDay[String(date)];

      if (day && usd > 0) {
        day.models.push({ model: series.model as string, usd });
      }
    });
  }

  for (const day of Object.values(byDay)) {
    day.models.sort((left, right) => right.usd - left.usd);
  }

  return byDay;
}

export type CostAnomaly = { kind: "daily_total" | "single_lecture"; message: string };

/**
 * The alarm thresholds sit well above the healthy baseline and below a looping day: tripping one
 * means something is running away, not that the product had a good day.
 *
 * Re-measured 2026-10-02 against September at corrected prices and with Soniox included, which
 * moved the baseline a long way: healthy days ran $1.50-8.40, rising through the month (the last
 * three were $8.34, $8.37, $7.58), so the old $10 would have fired on ordinary growth within days.
 * $20 is ~2.4x the busiest healthy day and still trips on a repeat of 2026-08-25, whose $19.63 of
 * model spend would now land on top of a ~$8 baseline.
 *
 * The busiest single lecture at corrected prices was $0.98 (385 calls on a long source, finished
 * fine; the old meter said ~$0.40), leaving the old $1.50 only 1.5x of headroom. Speech is not in
 * the lecture figure: Soniox's summary is per day, not per lecture, and transcription is ~$0.10 an
 * hour of audio.
 *
 * Soniox's summary covers the whole project behind SONIOX_API_KEY, so speech from any other
 * deployment sharing that key is counted too — an overcount, never a miss.
 *
 * Both are env-tunable (AI_COST_ALERT_DAILY_USD / AI_COST_ALERT_LECTURE_USD); with spend roughly
 * tripling over September, the daily one wants revisiting each month.
 */
export const DEFAULT_DAILY_ALERT_USD = 20;
export const DEFAULT_LECTURE_ALERT_USD = 2.5;

export function findCostAnomalies(
  day: DailyCostSummary,
  limits?: { dailyAlertUsd?: number; lectureAlertUsd?: number },
  /**
   * False when Soniox's summary could not be read. The day's total is then missing speech, and the
   * message says so rather than printing "Soniox $0.00" as if speech had been free.
   */
  options?: { sonioxAvailable?: boolean },
): CostAnomaly[] {
  const dailyLimit = limits?.dailyAlertUsd ?? DEFAULT_DAILY_ALERT_USD;
  const lectureLimit = limits?.lectureAlertUsd ?? DEFAULT_LECTURE_ALERT_USD;
  const anomalies: CostAnomaly[] = [];

  if (day.totalUsd >= dailyLimit) {
    anomalies.push({
      kind: "daily_total",
      message: `AI spend on ${day.date} was $${day.totalUsd.toFixed(2)} (limit $${dailyLimit}): Google $${day.googleUsd.toFixed(2)}, OpenRouter $${day.openRouterUsd.toFixed(2)}, ${options?.sonioxAvailable === false ? "Soniox not counted (usage summary unavailable)" : `Soniox $${day.sonioxUsd.toFixed(2)}`}, ${day.calls} calls.`,
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
  failureReasons: Array<{
    kind: GenerationKind;
    reason: string;
    plain: string;
    category: FailureCategory;
    count: number;
  }>;
  /** Every failure of the day sorted into who has to act, not just the printed groups. */
  failureCategories: Array<{ category: FailureCategory; count: number }>;
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
      failureCategories: countCategories([...day.failures.values()].flat()),
    }));
}
