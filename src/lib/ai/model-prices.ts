// Kept free of "server-only" so tests/ai-model-prices.test.mjs can hold every model the code
// calls against this table outside the Next.js runtime.

export type ModelPrice = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

/**
 * List prices per million tokens, for the calls whose provider does not tell us what it billed.
 *
 * Routed models (`or/` prefix) are priced at the gateway's rate, not the provider's, because the
 * gateway is who bills them. They are only a fallback now: OpenRouter returns the charge for every
 * call (`usage.cost`) and the usage log stores that instead (openrouter.ts). Direct Gemini calls
 * have no such field, so for them this table is the meter.
 *
 * Direct Gemini rates re-checked against https://ai.google.dev/gemini-api/docs/pricing on
 * 2026-10-20, when the Gemini spending cap was reached at €100 while this log said $62: every
 * rate below matched, so that gap was not a price (see ai-cost-report.ts).
 *
 * Read live from OpenRouter's models API on 2026-10-02, which is also when two of these were found
 * stale: GLM 5.3 Flash had doubled from $0.075/$0.25, and routed gemini-3.7-flash's half-price
 * promotion (2026-08-23) had ended. A routed model missing from here logged no cost at all, which
 * is how 17,159 of September's gemini-3.5-flash-lite calls went unpriced — the reason
 * tests/ai-model-prices.test.mjs fails on any model the code calls without a price.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Z.ai GLM 5.3 Flash. Reasoning is mandatory on its endpoint and billed inside completion
  // tokens, so the output rate is also what the thinking costs.
  "or/z-ai/glm-5.3-flash": { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.5 },
  "or/google/gemini-3.7-flash": { inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75 },
  "or/google/gemini-3.6-flash": { inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75 },
  "or/google/gemini-3.5-flash-lite": { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
  "or/google/gemini-2.5-flash-lite": { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 },
  "gemini-3.7-flash": { inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75 },
  "gemini-3.6-flash": { inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75 },
  "gemini-3.5-flash-lite": { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
  "gemini-3.1-flash-lite": { inputUsdPerMillion: 0.25, outputUsdPerMillion: 1.5 },
  "gemini-3-flash-preview": { inputUsdPerMillion: 0.5, outputUsdPerMillion: 3 },
  "gemini-2.5-flash-lite": { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 },
  // Every voice. Output is audio at 25 tokens a second, so $9/M is $0.81 an hour of speech.
  // Both rates double on 2027-01-01 (SCHEDULED_PRICE_CHANGES below).
  "gemini-3.8-flash-tts": { inputUsdPerMillion: 0.5, outputUsdPerMillion: 9 },
  // Embeddings bill input only. Logged since 2026-10-20 with a token count estimated from the
  // text (embeddings.ts). Google's pricing page now lists only gemini-embedding-2 ($0.20); this
  // model kept its $0.15.
  "gemini-embedding-001": { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0 },
};

/**
 * Price changes Google has already announced, applied from their date on so the log does not
 * keep billing the old rate until someone remembers. Most recent last.
 */
export const SCHEDULED_PRICE_CHANGES: Record<string, Array<ModelPrice & { from: string }>> = {
  "gemini-3.8-flash-tts": [
    { from: "2027-01-01T00:00:00Z", inputUsdPerMillion: 1, outputUsdPerMillion: 18 },
  ],
  "gemini-3.6-flash": [
    { from: "2027-01-01T00:00:00Z", inputUsdPerMillion: 1.5, outputUsdPerMillion: 7.5 },
  ],
};

export function normalizePricedModel(model: string) {
  return model.toLowerCase().replace(/^models\//, "");
}

/** The model's rate at `at` (now by default), with any scheduled change that has taken effect. */
export function getModelPrice(model: string, at: Date = new Date()): ModelPrice | null {
  const key = normalizePricedModel(model);
  const change = (SCHEDULED_PRICE_CHANGES[key] ?? [])
    .filter((entry) => Date.parse(entry.from) <= at.getTime())
    .at(-1);

  if (change) {
    return {
      inputUsdPerMillion: change.inputUsdPerMillion,
      outputUsdPerMillion: change.outputUsdPerMillion,
    };
  }

  return MODEL_PRICES[key] ?? null;
}
