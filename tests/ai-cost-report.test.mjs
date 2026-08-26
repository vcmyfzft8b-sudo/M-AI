import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DAILY_ALERT_USD,
  DEFAULT_LECTURE_ALERT_USD,
  findCostAnomalies,
  isOpenRouterBilledModel,
  summarizeAiUsageByDay,
} from "../src/lib/ai-cost-report.ts";

const row = (overrides) => ({
  created_at: "2026-08-25T10:00:00Z",
  model: "gemini-2.5-flash-lite",
  stage: "note_extract",
  success: true,
  estimated_cost_usd: 0.001,
  lecture_id: "lec-1",
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
