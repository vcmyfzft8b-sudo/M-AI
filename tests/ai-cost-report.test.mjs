import assert from "node:assert/strict";
import test from "node:test";

import {
  CAP_WARN_SHARE,
  DEFAULT_DAILY_ALERT_USD,
  DEFAULT_GEMINI_MONTHLY_SPEND_CAP_EUR,
  DEFAULT_LECTURE_ALERT_USD,
  GEMINI_SPEND_CAP_TIME_ZONE,
  GENERATION_KINDS,
  SONIOX_BUDGET_TIME_ZONE,
  aggregateAiUsageRows,
  assessMonthlyCap,
  billingMonth,
  explainFailure,
  failureReasonKey,
  findCapAnomalies,
  findCostAnomalies,
  isOpenRouterBilledModel,
  parseSonioxUsageSummary,
  summarizeAiUsageByDay,
  summarizeAiUsageDays,
  summarizeGenerationByDay,
} from "../src/lib/ai-cost-report.ts";

const row = (overrides) => ({
  created_at: "2026-08-25T10:00:00Z",
  model: "gemini-2.5-flash-lite",
  stage: "note_extract",
  success: true,
  estimated_cost_usd: 0.001,
  lecture_id: "lec-1",
  error_code: null,
  error_message: null,
  ...overrides,
});

const gen = (overrides) => ({
  kind: "notes",
  settled_at: "2026-08-25T10:00:00Z",
  status: "ready",
  error_message: null,
  ...overrides,
});

test("spend is split by who bills the call, not by which weights ran", () => {
  // The same 3.7-flash weights cost half through the gateway; the whole point of the report is
  // telling the two consoles apart.
  assert.equal(isOpenRouterBilledModel("or/google/gemini-3.7-flash"), true);
  assert.equal(isOpenRouterBilledModel("gemini-3.7-flash"), false);

  const [day] = summarizeAiUsageByDay([
    row({ model: "or/google/gemini-3.7-flash", stage: "note_write", estimated_cost_usd: 0.05 }),
    row({ model: "gemini-3.7-flash", stage: "note_write", estimated_cost_usd: 0.1 }),
    row({ estimated_cost_usd: 0.002 }),
  ]);

  assert.equal(day.openRouterUsd, 0.05);
  assert.equal(day.googleUsd, 0.102);
  assert.equal(day.totalUsd, 0.152);
});

test("days are separated, ordered, and carry their own top stages and lectures", () => {
  const summary = summarizeAiUsageByDay([
    row({ created_at: "2026-08-25T23:59:00Z", estimated_cost_usd: 0.2, lecture_id: "big" }),
    row({ created_at: "2026-08-26T00:01:00Z", estimated_cost_usd: 0.01, lecture_id: "small" }),
    row({ created_at: "2026-08-25T12:00:00Z", stage: "note_write", estimated_cost_usd: 0.05, success: false, lecture_id: "big" }),
  ]);

  assert.deepEqual(summary.map((day) => day.date), ["2026-08-25", "2026-08-26"]);
  assert.equal(summary[0].failedCalls, 1);
  assert.equal(summary[0].topStages[0].stage, "note_extract");
  assert.equal(summary[0].topLectures[0].lectureId, "big");
  assert.equal(summary[0].topLectures[0].usd, 0.25);
});

test("a null cost row still counts as a call and never poisons the totals", () => {
  const [day] = summarizeAiUsageByDay([row({ estimated_cost_usd: null, lecture_id: null })]);

  assert.equal(day.totalUsd, 0);
  assert.equal(day.calls, 1);
  assert.deepEqual(day.topLectures, []);
});

test("the alarm trips on a runaway day or a runaway lecture, and stays quiet on a healthy one", () => {
  // The figures of the busiest healthy day of September 2026 at corrected prices (dated to match
  // row()): $6.19 of model calls, its biggest lecture $0.98 on a long source that finished fine,
  // plus $2.18 of Soniox speech.
  const [healthy] = summarizeAiUsageByDay(
    [
      row({ estimated_cost_usd: 0.98, lecture_id: "long-source" }),
      row({ estimated_cost_usd: 5.21, lecture_id: null }),
    ],
    { "2026-08-25": { usd: 2.18, models: [{ model: "tts-rt-v2", usd: 2.18 }] } },
  );
  assert.equal(healthy.totalUsd, 8.37);
  assert.deepEqual(findCostAnomalies(healthy), []);

  // The 2026-08-25 runaway ($19.50 of model calls, one $5.50 lecture) landing on today's
  // baseline must trip both alarms.
  const [incident] = summarizeAiUsageByDay(
    [
      row({ estimated_cost_usd: 14, lecture_id: null }),
      row({ estimated_cost_usd: 5.5, lecture_id: "runaway" }),
    ],
    { "2026-08-25": { usd: 2.2, models: [] } },
  );
  const anomalies = findCostAnomalies(incident);

  assert.deepEqual(anomalies.map((anomaly) => anomaly.kind), ["daily_total", "single_lecture"]);
  assert.match(anomalies[0].message, /21\.70/);
  assert.match(anomalies[0].message, /Soniox \$2\.20/);
  assert.match(anomalies[1].message, /runaway/);

  // A failed Soniox read is said out loud, never shown as free speech.
  const [unread] = findCostAnomalies(incident, undefined, { sonioxAvailable: false });
  assert.match(unread.message, /Soniox not counted/);
  assert.doesNotMatch(unread.message, /Soniox \$/);

  // Custom limits override the defaults.
  assert.equal(findCostAnomalies(healthy, { dailyAlertUsd: 1, lectureAlertUsd: 0.3 }).length, 2);
  assert.ok(DEFAULT_DAILY_ALERT_USD >= 2 * 8.37, "the default must sit well above the busiest healthy day");
  assert.ok(DEFAULT_LECTURE_ALERT_USD >= 2 * 0.98, "the default must sit well above the busiest healthy lecture");
});

test("Soniox speech is its own billing line and a speech-only day still gets a summary", () => {
  const summary = summarizeAiUsageByDay([row({ estimated_cost_usd: 0.5 })], {
    "2026-08-24": { usd: 1.25, models: [{ model: "tts-rt-v2", usd: 1.25 }] },
    "2026-08-25": { usd: 0.75, models: [] },
    "2026-08-26": { usd: 0, models: [] },
  });

  assert.deepEqual(summary.map((day) => day.date), ["2026-08-24", "2026-08-25"]);
  assert.equal(summary[0].calls, 0);
  assert.equal(summary[0].sonioxUsd, 1.25);
  assert.equal(summary[0].totalUsd, 1.25);
  assert.deepEqual(summary[0].sonioxModels, [{ model: "tts-rt-v2", usd: 1.25 }]);
  assert.equal(summary[1].totalUsd, 1.25);
  assert.equal(summary[1].googleUsd, 0.5);

  // No Soniox data at all (key missing, API down) leaves the model-call days as they were.
  const [plain] = summarizeAiUsageByDay([row({ estimated_cost_usd: 0.5 })], null);
  assert.equal(plain.sonioxUsd, 0);
  assert.equal(plain.totalUsd, 0.5);
});

test("Soniox's usage summary is read per day and per model, and an unknown shape reads as unavailable", () => {
  // Trimmed from a real 2026-09-30 response: parallel arrays, costs as decimal strings.
  const parsed = parseSonioxUsageSummary({
    total: { model: null, days: ["2026-09-29", "2026-09-30"], cost_usd: ["2.1502", "2.2353155000"] },
    models: [
      { model: "stt-async-v5", days: ["2026-09-29", "2026-09-30"], cost_usd: ["0.1", "0.1864105000"] },
      { model: "tts-rt-v2", days: ["2026-09-29", "2026-09-30"], cost_usd: ["2.0502", "1.9565690000"] },
      { model: "tts-rt-v1", days: ["2026-09-29", "2026-09-30"], cost_usd: ["0", "0.0000000000"] },
    ],
  });

  assert.deepEqual(parsed["2026-09-30"], {
    usd: 2.2353,
    models: [
      { model: "tts-rt-v2", usd: 1.9566 },
      { model: "stt-async-v5", usd: 0.1864 },
    ],
  });
  assert.equal(parsed["2026-09-29"].usd, 2.1502);
  assert.equal(parseSonioxUsageSummary({ error: "unauthorized" }), null);
  assert.equal(parseSonioxUsageSummary(null), null);
});

test("a call that used tokens but logged no cost is reported as unpriced, by model", () => {
  const [day] = summarizeAiUsageByDay([
    row({ model: "or/new/model", estimated_cost_usd: null, prompt_token_count: 1200 }),
    row({ model: "or/new/model", estimated_cost_usd: null, prompt_token_count: 800 }),
    // A call that failed before any reply has no tokens and no cost; that is not a pricing gap.
    row({ estimated_cost_usd: null, prompt_token_count: null, success: false }),
    row({ estimated_cost_usd: 0.01, prompt_token_count: 500 }),
  ]);

  assert.deepEqual(day.unpricedCalls, [{ model: "or/new/model", calls: 2 }]);
});

test("failed calls are grouped by stage and cause, with the provider's own error code kept", () => {
  const [day] = summarizeAiUsageByDay([
    row({ success: false, stage: "note_write", error_code: "503", error_message: "overloaded" }),
    row({ success: false, stage: "note_write", error_code: "503", error_message: "overloaded" }),
    row({ success: false, stage: "note_extract", error_message: "schema mismatch" }),
    row(),
  ]);

  assert.equal(day.failedCalls, 3);
  assert.deepEqual(
    day.topCallFailures.map(({ stage, reason, count }) => ({ stage, reason, count })),
    [
      { stage: "note_write", reason: "503: overloaded", count: 2 },
      { stage: "note_extract", reason: "schema mismatch", count: 1 },
    ],
  );
});

test("one fault reported with varying indices and ids collapses into a single group", () => {
  // The real shape: quiz generation rejects questions.0 on one lecture and questions.1 on the
  // next. Two rows, one bug -- the report has to say "2", not list it twice.
  assert.equal(
    failureReasonKey("questions.0.explanation: Too big: expected <=760 characters"),
    failureReasonKey("questions.11.explanation: Too big: expected <=760 characters"),
  );
  assert.notEqual(failureReasonKey("timed out"), failureReasonKey("no speech detected"));

  const [day] = summarizeGenerationByDay([
    gen({ kind: "quizzes", status: "failed", error_message: "questions.0.explanation: Too big" }),
    gen({ kind: "quizzes", status: "failed", error_message: "questions.4.explanation: Too big" }),
  ]);

  assert.deepEqual(
    day.failureReasons.map(({ kind, reason, count }) => ({ kind, reason, count })),
    [{ kind: "quizzes", reason: "questions.0.explanation: Too big", count: 2 }],
  );
});

test("generation counts split succeeded, failed and still-running per artifact kind", () => {
  const [day] = summarizeGenerationByDay([
    gen({ kind: "notes", status: "ready" }),
    gen({ kind: "notes", status: "failed", error_message: "Obdelava je trajala predolgo." }),
    // An upload abandoned mid-flight is not a generation defect, so it must land in pending.
    gen({ kind: "notes", status: "uploading" }),
    gen({ kind: "flashcards", status: "ready" }),
    gen({ kind: "quizzes", status: "generating" }),
    gen({ kind: "practiceTests", status: "ready" }),
  ]);

  assert.deepEqual(day.totals, { total: 6, succeeded: 3, failed: 1, pending: 2 });
  assert.deepEqual(day.kinds.notes, { total: 3, succeeded: 1, failed: 1, pending: 1 });
  assert.deepEqual(day.kinds.quizzes, { total: 1, succeeded: 0, failed: 0, pending: 1 });
  assert.equal(day.failureReasons.length, 1);
  assert.equal(day.failureReasons[0].kind, "notes");
  assert.equal(day.failureReasons[0].reason, "Obdelava je trajala predolgo.");

  // Every kind is always present, so the report never has to guard on a missing key.
  assert.deepEqual(Object.keys(day.kinds).sort(), [...GENERATION_KINDS].sort());
});

test("generation days are separated and ordered, like the spend days", () => {
  const summary = summarizeGenerationByDay([
    gen({ settled_at: "2026-08-26T00:01:00Z" }),
    gen({ settled_at: "2026-08-25T23:59:00Z", status: "failed", error_message: null }),
  ]);

  assert.deepEqual(summary.map((day) => day.date), ["2026-08-25", "2026-08-26"]);
  assert.equal(summary[0].totals.failed, 1);
  // A failure with no message still has to be counted and shown as something.
  assert.equal(summary[0].failureReasons[0].reason, "(no message)");
  assert.equal(summary[0].failureReasons[0].category, "unknown");
});

test("every failure carries a plain-English reading and who has to act on it", () => {
  // The exact strings production emits, one per category, verbatim from a 30-day sweep.
  const overloaded = explainFailure(
    '429: {"error":{"code":429,"message":"This model is currently experiencing high demand."}}',
  );
  assert.equal(overloaded.category, "provider");
  assert.match(overloaded.plain, /overloaded/i);

  const badAudio = explainFailure(
    "V zvoku ni bilo mogoče zaznati dovolj jasnega govora. Preveri posnetek in poskusi znova.",
  );
  assert.equal(badAudio.category, "upload");
  // The Slovenian message has to come back out in English, or the summary cannot use it.
  assert.match(badAudio.plain, /no clear speech/i);

  const schema = explainFailure(
    '400: {"error":{"code":400,"message":"The specified schema produces a constraint that has too many states for serving."}}',
  );
  assert.equal(schema.category, "our-code");
  // Measured over 30d: all 12,626 of these carry null cost and zero tokens -- Gemini rejects the
  // request at validation, so it is wasted work but not wasted money. Do not call it billed.
  assert.doesNotMatch(schema.plain, /still billed/i);
  assert.match(schema.plain, /costs nothing/i);

  assert.equal(
    explainFailure(
      "GeminiTruncatedOutputError: Model output was truncated: generation hit the 2400-token output limit",
    ).category,
    "our-code",
  );
  assert.equal(
    explainFailure('ZodError: [ { "origin": "string", "code": "too_big", "maximum": 140 } ]').category,
    "our-code",
  );

  // A cause nobody has classified yet must survive as itself, not be forced into a known bucket.
  const novel = explainFailure("Kessler syndrome in the GPU cluster");
  assert.equal(novel.category, "unknown");
  assert.equal(novel.plain, "Kessler syndrome in the GPU cluster");

  assert.equal(explainFailure(null).category, "unknown");
  assert.equal(explainFailure("").category, "unknown");
});

test("categories roll up over every failure, not just the groups the report prints", () => {
  // TOP_CALL_FAILURES caps the printed list at 5; a roll-up computed from that list would
  // under-count, which is exactly the number a reader would trust most.
  const failures = [];

  for (let index = 0; index < 8; index += 1) {
    failures.push(
      row({ success: false, stage: `stage_${index}`, error_message: "Model returned empty text output." }),
    );
  }

  failures.push(row({ success: false, stage: "extra", error_message: "The service is currently unavailable." }));

  const [day] = summarizeAiUsageByDay(failures);

  assert.equal(day.topCallFailures.length, 5, "the printed list stays capped");
  assert.deepEqual(day.callFailureCategories, [
    { category: "our-code", count: 8 },
    { category: "provider", count: 1 },
  ]);

  const [gen1] = summarizeGenerationByDay([
    gen({ kind: "notes", status: "failed", error_message: "The link is private or requires permission to view." }),
    gen({ kind: "notes", status: "failed", error_message: "This page does not contain enough readable text to summarize." }),
    gen({ kind: "quizzes", status: "failed", error_message: "questions.0.explanation: Too big: expected string to have <=760 characters" }),
  ]);

  assert.deepEqual(gen1.failureCategories, [
    { category: "upload", count: 2 },
    { category: "our-code", count: 1 },
  ]);
});

test("a day arrives as one SQL aggregate and summarises like the raw rows it came from", () => {
  // The shape migration 0072's ai_cost_report_window returns for one UTC day.
  const [day] = summarizeAiUsageDays({
    "2026-10-19": {
      groups: [
        { model: "gemini-3.8-flash-tts", stage: "tutor_speech", calls: 1800, failed_calls: 2, cost_usd: 3.1, unpriced_calls: 0 },
        { model: "or/z-ai/glm-5.3-flash", stage: "note_write", calls: 400, failed_calls: 0, cost_usd: 2.4, unpriced_calls: 0 },
        { model: "or/new/model", stage: "chat", calls: 9, failed_calls: 0, cost_usd: 0, unpriced_calls: 9 },
      ],
      lectures: [
        { lecture_id: "small", cost_usd: 0.1, calls: 4 },
        { lecture_id: "big", cost_usd: 0.9, calls: 40 },
      ],
      failures: [
        { stage: "tutor_speech", error_code: "429", error_message: "high demand", failures: 2 },
      ],
    },
  });

  assert.equal(day.date, "2026-10-19");
  assert.equal(day.calls, 2209);
  assert.equal(day.failedCalls, 2);
  assert.equal(day.googleUsd, 3.1);
  assert.equal(day.openRouterUsd, 2.4);
  assert.equal(day.topLectures[0].lectureId, "big");
  assert.deepEqual(day.unpricedCalls, [{ model: "or/new/model", calls: 9 }]);
  // A grouped failure counts as many failures as it carries, not as one.
  assert.deepEqual(
    day.topCallFailures.map(({ stage, reason, count }) => ({ stage, reason, count })),
    [{ stage: "tutor_speech", reason: "429: high demand", count: 2 }],
  );
  assert.deepEqual(day.callFailureCategories, [{ category: "provider", count: 2 }]);

  // Raw rows go through the same aggregate, so both paths agree.
  const rows = [
    row({ created_at: "2026-10-19T08:00:00Z", estimated_cost_usd: 0.25, lecture_id: "a" }),
    row({ created_at: "2026-10-19T09:00:00Z", estimated_cost_usd: 0.5, lecture_id: "a", success: false, error_code: "503", error_message: "overloaded" }),
    row({ created_at: "2026-10-19T10:00:00Z", estimated_cost_usd: null, prompt_token_count: 10 }),
  ];
  assert.deepEqual(summarizeAiUsageDays(aggregateAiUsageRows(rows)), summarizeAiUsageByDay(rows));
  assert.deepEqual(aggregateAiUsageRows(rows)["2026-10-19"].groups, [
    { model: "gemini-2.5-flash-lite", stage: "note_extract", calls: 3, failed_calls: 1, cost_usd: 0.75, unpriced_calls: 1 },
  ]);
});

test("the Gemini cap month starts at Pacific midnight, through both daylight-saving changes", () => {
  // October is daylight time (UTC-7), December standard time (UTC-8); November starts on the very
  // night daylight time ends, at 02:00 local, so its midnight is still UTC-7.
  assert.deepEqual(billingMonth(new Date("2026-10-20T13:23:00Z"), GEMINI_SPEND_CAP_TIME_ZONE), {
    key: "2026-10",
    timeZone: "America/Los_Angeles",
    startIso: "2026-10-01T07:00:00.000Z",
    endIso: "2026-11-01T07:00:00.000Z",
  });
  assert.equal(
    billingMonth(new Date("2026-11-15T12:00:00Z"), GEMINI_SPEND_CAP_TIME_ZONE).endIso,
    "2026-12-01T08:00:00.000Z",
  );
  assert.equal(
    billingMonth(new Date("2027-03-20T12:00:00Z"), GEMINI_SPEND_CAP_TIME_ZONE).startIso,
    "2027-03-01T08:00:00.000Z",
  );
  assert.equal(
    billingMonth(new Date("2027-03-20T12:00:00Z"), GEMINI_SPEND_CAP_TIME_ZONE).endIso,
    "2027-04-01T07:00:00.000Z",
  );

  // The 04:15 UTC run on the 1st is still the evening of the last day in California.
  assert.equal(billingMonth(new Date("2026-11-01T04:15:00Z"), GEMINI_SPEND_CAP_TIME_ZONE).key, "2026-10");
  assert.equal(billingMonth(new Date("2027-01-01T04:15:00Z"), GEMINI_SPEND_CAP_TIME_ZONE).key, "2026-12");

  // Soniox meters whole UTC days, so its month is the UTC one.
  assert.deepEqual(billingMonth(new Date("2026-11-01T04:15:00Z"), SONIOX_BUDGET_TIME_ZONE), {
    key: "2026-11",
    timeZone: "UTC",
    startIso: "2026-11-01T00:00:00.000Z",
    endIso: "2026-12-01T00:00:00.000Z",
  });
});

/*
 * Google-direct spend per UTC day in October 2026, from production's ai_usage_events. On Oct 15
 * every voice moved to Gemini TTS; on Oct 20 at 13:23 UTC the €100 spending cap was reached.
 */
const OCTOBER_GOOGLE_USD = [
  0.55, 0.4, 0.71, 1.58, 1.42, 0.87, 0.77, 1.15, 0.7, 0.74, 1.6, 1.22, 1.68, 1.41,
  7.06, 3.92, 9.15, 15.7, 9.63,
];
const EUR_PER_USD = 1 / 1.1355;

function octoberCapCheck(runIso, cap) {
  const now = new Date(runIso);
  const completeDays = Number(runIso.slice(8, 10)) - 1;
  const recent = OCTOBER_GOOGLE_USD.slice(0, completeDays);

  return assessMonthlyCap({
    provider: "google",
    month: billingMonth(now, GEMINI_SPEND_CAP_TIME_ZONE),
    now,
    cap,
    currency: "EUR",
    capCurrencyPerUsd: EUR_PER_USD,
    spentUsd: recent.reduce((sum, usd) => sum + usd, 0),
    recentDailyUsd: recent,
    complete: true,
  });
}

test("the October cap would have been announced four mornings before it was reached", () => {
  // Before the voices moved, $1.50 a day was nowhere near even the old €100 cap.
  const calm = octoberCapCheck("2026-10-15T04:15:00Z", 100);
  assert.deepEqual(findCapAnomalies(calm), []);
  assert.ok(calm.forecast < 60, `forecast €${calm.forecast}`);

  // The first morning after the switch, one $7 day is enough: the pace follows yesterday, and
  // at that pace the month ends far past the cap.
  const warned = octoberCapCheck("2026-10-16T04:15:00Z", 100);
  assert.equal(warned.paceUsdPerDay, 7.06);
  assert.ok(warned.forecast > 100, `forecast €${warned.forecast}`);
  const [forecast] = findCapAnomalies(warned);
  assert.equal(forecast.kind, "monthly_cap_forecast");
  assert.match(forecast.message, /€100\.00 monthly spending cap around 2026-10-\d\d/);
  assert.match(forecast.message, /https:\/\/ai\.studio\/spend/);

  // At the new €200 cap the same October still warns, from the morning after the $15.70 day.
  const raised = octoberCapCheck("2026-10-19T04:15:00Z", DEFAULT_GEMINI_MONTHLY_SPEND_CAP_EUR);
  assert.equal(raised.paceUsdPerDay, 15.7);
  assert.equal(raised.capReachedOn > "2026-10-19" && raised.capReachedOn < "2026-11-01", true);
  assert.deepEqual(findCapAnomalies(raised).map((anomaly) => anomaly.kind), ["monthly_cap_forecast"]);
});

test("70% of a cap already spent warns whatever the forecast says, and says how to act once", () => {
  const month = billingMonth(new Date("2026-10-28T04:15:00Z"), GEMINI_SPEND_CAP_TIME_ZONE);
  const status = assessMonthlyCap({
    provider: "google",
    month,
    now: new Date("2026-10-28T04:15:00Z"),
    cap: 200,
    currency: "EUR",
    capCurrencyPerUsd: 1,
    spentUsd: 150,
    recentDailyUsd: [0, 0, 0],
    complete: false,
  });

  assert.equal(status.usedShare, 0.75);
  assert.equal(status.forecast, 150, "no pace, no growth");
  const anomalies = findCapAnomalies(status);
  assert.deepEqual(anomalies.map((anomaly) => anomaly.kind), ["monthly_cap_used"]);
  assert.match(anomalies[0].message, /€150\.00 \(at least: some days could not be read\), 75% of the €200\.00/);
  assert.match(anomalies[0].message, /ai\.studio\/spend/);
  assert.ok(CAP_WARN_SHARE === 0.7);

  // Both alarms at once still name the remedy only once.
  const both = findCapAnomalies({ ...status, forecastShare: 1.3, forecast: 260 });
  assert.equal(both.length, 2);
  assert.equal(both.filter((anomaly) => /ai\.studio\/spend/.test(anomaly.message)).length, 1);
});

test("a Soniox budget is checked in dollars against Soniox's own meter", () => {
  const now = new Date("2026-10-14T04:15:00Z");
  const status = assessMonthlyCap({
    provider: "soniox",
    month: billingMonth(now, SONIOX_BUDGET_TIME_ZONE),
    now,
    cap: 50,
    currency: "USD",
    capCurrencyPerUsd: 1,
    spentUsd: 41,
    recentDailyUsd: [3, 3.2, 3.4],
    complete: true,
  });

  assert.equal(status.usedShare, 0.82);
  const anomalies = findCapAnomalies(status);
  assert.deepEqual(anomalies.map((anomaly) => anomaly.kind), ["monthly_cap_used", "monthly_cap_forecast"]);
  assert.match(anomalies[0].message, /Soniox spend for 2026-10 is \$41\.00, 82% of the \$50\.00 monthly budget/);
  assert.match(anomalies[1].message, /Soniox console/);
});

test("Gemini's spending-cap 429 is a billing failure, not an overloaded provider", () => {
  // Verbatim from production, 2026-10-20 13:23 UTC.
  const capped = explainFailure(
    '429: Gemini speech refused (429): {\n  "error": {\n    "code": 429,\n    "message": "Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend to manage your project spend cap. Learn more at https://ai.google.dev/gemini-api/docs/billing#project-spend-caps. ",\n    "status": "RESOURCE_EXHAUSTED"',
  );
  assert.equal(capped.category, "billing");
  assert.match(capped.plain, /monthly spending cap/);
  assert.match(capped.plain, /ai\.studio\/spend/);

  // An ordinary quota or rate limit stays the provider's, and overload stays overload.
  assert.equal(explainFailure("429: RESOURCE_EXHAUSTED: Quota exceeded for metric").category, "provider");
  assert.equal(explainFailure("503: The model is overloaded.").category, "provider");
  assert.equal(explainFailure("402: Insufficient credits. Add more using https://openrouter.ai/settings/credits").category, "billing");

  const [day] = summarizeAiUsageByDay([
    row({ success: false, stage: "podcast_speech", error_code: "429", error_message: "Your project has exceeded its monthly spending cap." }),
    row({ success: false, stage: "note_write", error_code: "503", error_message: "overloaded" }),
  ]);
  assert.deepEqual(
    day.callFailureCategories.map((entry) => entry.category).sort(),
    ["billing", "provider"],
  );
});
