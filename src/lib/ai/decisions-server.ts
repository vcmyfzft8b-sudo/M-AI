import "server-only";

import { getCurrentAbortSignal, getRemainingBudgetMs } from "@/lib/abort-context";
import type { DecisionOptions } from "@/lib/ai/decisions";
import { JEV_INPUT_USD_PER_MTOK } from "@/lib/ai/jev";
import { logGeminiUsageEvent, type GeminiUsageContext } from "@/lib/ai/usage-logging";

/**
 * The server half of the decision layer: the deadline a decision inherits, and the ledger it
 * lands in.
 *
 * Split from decisions.ts so that file stays importable by scripts/jev-eval.mjs, which has no
 * Next.js runtime, no Supabase client and no invocation budget to inherit. Everything in here is
 * the part that only makes sense inside a request.
 */
export function jevDecisionOptions(usageContext?: GeminiUsageContext): DecisionOptions {
  return {
    /*
     * The surrounding invocation's deadline is carried across, the way language-check.ts carries
     * it into a repair. Without it a decision started with a second of invocation left would
     * happily buy a six-second attempt whose answer nothing will read — and worse, would hold
     * the step open past the point where the fallback could still have run.
     */
    signal: getCurrentAbortSignal(),
    remainingBudgetMs: getRemainingBudgetMs(),
    log: (params) => logJevDecision({ ...params, usageContext }),
  };
}

/**
 * Records the call in `ai_usage_events`, the same table every model call lands in, so the daily
 * cost report and its anomaly alarm cover this vendor too rather than seeing spend appear from
 * nowhere. Two details differ from a model call and both are deliberate:
 *
 * - The output token count is zero, because it is. Jev bills input only, and writing a plausible
 *   output figure would put a rate in the report that does not exist.
 * - A failed decision is logged as a failure with zero cost rather than not logged at all. A Jev
 *   outage is invisible by design — every caller falls back and the product keeps working — so
 *   this row is the only place it would ever show up.
 */
async function logJevDecision(params: {
  stage: string;
  usage: { inputTokens: number; costUsd: number; durationMs: number; requestCount: number };
  questionCount: number;
  success: boolean;
  usageContext?: GeminiUsageContext;
}) {
  await logGeminiUsageEvent({
    model: "typesafe-ai/jev",
    stage: params.stage,
    attemptIndex: 0,
    success: params.success,
    usageMetadata: {
      promptTokenCount: params.usage.inputTokens,
      candidatesTokenCount: 0,
      totalTokenCount: params.usage.inputTokens,
    },
    context: params.usageContext,
    metadata: {
      provider: "typesafe",
      questionCount: params.questionCount,
      httpRequests: params.usage.requestCount,
      durationMs: params.usage.durationMs,
      // estimateGeminiCostUsd knows nothing about this vendor's card, so the figure is carried.
      jevCostUsd: (params.usage.inputTokens * JEV_INPUT_USD_PER_MTOK) / 1_000_000,
    },
  });
}
