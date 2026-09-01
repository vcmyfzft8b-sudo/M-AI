import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENROUTER_DEFAULT_TIMEOUT_MS,
  STRUCTURED_FALLBACK_RESERVE_MS,
  resolveAiAttemptTimeoutMs,
  resolveOpenRouterTierTimeoutMs,
} from "../src/lib/ai/attempt-budget.ts";

test("the production practice-test timing leaves a full fallback window", () => {
  // The two 2026-08-31 requests reached their pooled model calls with about 190s left. Before
  // this clamp GLM took the full 180s and the fallback was aborted with the invocation. The
  // primary now gets 95s, leaving 90s plus the 5s hand-off margin.
  assert.equal(
    resolveAiAttemptTimeoutMs({
      requestedTimeoutMs: OPENROUTER_DEFAULT_TIMEOUT_MS,
      remainingBudgetMs: 190_000,
      fallbackReserveMs: STRUCTURED_FALLBACK_RESERVE_MS,
    }),
    95_000,
  );
});

test("a primary keeps its measured timeout when both it and the fallback fit", () => {
  assert.equal(
    resolveAiAttemptTimeoutMs({
      requestedTimeoutMs: OPENROUTER_DEFAULT_TIMEOUT_MS,
      remainingBudgetMs: 280_000,
      fallbackReserveMs: STRUCTURED_FALLBACK_RESERVE_MS,
    }),
    OPENROUTER_DEFAULT_TIMEOUT_MS,
  );
});

test("a call outside an invocation budget keeps the provider timeout", () => {
  assert.equal(
    resolveAiAttemptTimeoutMs({
      requestedTimeoutMs: OPENROUTER_DEFAULT_TIMEOUT_MS,
      remainingBudgetMs: undefined,
      fallbackReserveMs: STRUCTURED_FALLBACK_RESERVE_MS,
    }),
    OPENROUTER_DEFAULT_TIMEOUT_MS,
  );
});

test("a primary is skipped when only its fallback has time to answer", () => {
  assert.equal(
    resolveAiAttemptTimeoutMs({
      requestedTimeoutMs: OPENROUTER_DEFAULT_TIMEOUT_MS,
      remainingBudgetMs: 105_000,
      fallbackReserveMs: STRUCTURED_FALLBACK_RESERVE_MS,
    }),
    null,
  );
});

test("every OpenRouter call is clamped to the invocation that owns it", () => {
  assert.equal(
    resolveAiAttemptTimeoutMs({
      requestedTimeoutMs: OPENROUTER_DEFAULT_TIMEOUT_MS,
      remainingBudgetMs: 50_000,
    }),
    45_000,
  );
});

test("a routed fallback uses Gemini's structured window, not the primary's default", () => {
  assert.equal(
    resolveOpenRouterTierTimeoutMs({ stageTimeoutMs: undefined, tierIndex: 0 }),
    OPENROUTER_DEFAULT_TIMEOUT_MS,
  );
  assert.equal(
    resolveOpenRouterTierTimeoutMs({ stageTimeoutMs: undefined, tierIndex: 1 }),
    STRUCTURED_FALLBACK_RESERVE_MS,
  );
  assert.equal(
    resolveOpenRouterTierTimeoutMs({ stageTimeoutMs: 60_000, tierIndex: 1 }),
    60_000,
  );
});
