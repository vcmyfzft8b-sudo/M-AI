import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DAILY_ALERT_USD,
  DEFAULT_LECTURE_ALERT_USD,
  GENERATION_KINDS,
  explainFailure,
  failureReasonKey,
  findCostAnomalies,
  isOpenRouterBilledModel,
  summarizeAiUsageByDay,
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
  // Healthy day: well under both defaults (baseline is ~$0.5-2/day, worst measured lecture $0.40).
  const [healthy] = summarizeAiUsageByDay([
    row({ estimated_cost_usd: 0.4, lecture_id: "ok" }),
    row({ estimated_cost_usd: 0.9, lecture_id: null }),
  ]);
  assert.deepEqual(findCostAnomalies(healthy), []);

  // The 2026-08-25 shape: a $19 day with a $5 lecture must trip both alarms.
  const [incident] = summarizeAiUsageByDay([
    row({ estimated_cost_usd: 14, lecture_id: null }),
    row({ estimated_cost_usd: 5.5, lecture_id: "runaway" }),
  ]);
  const anomalies = findCostAnomalies(incident);

  assert.deepEqual(anomalies.map((anomaly) => anomaly.kind), ["daily_total", "single_lecture"]);
  assert.match(anomalies[0].message, /19\.50/);
  assert.match(anomalies[1].message, /runaway/);

  // Custom limits override the defaults.
  assert.equal(findCostAnomalies(healthy, { dailyAlertUsd: 1, lectureAlertUsd: 0.3 }).length, 2);
  assert.ok(DEFAULT_DAILY_ALERT_USD > 2, "the default must sit above the healthy baseline");
  assert.ok(DEFAULT_LECTURE_ALERT_USD > 0.5, "the default must sit above the worst healthy lecture");
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
