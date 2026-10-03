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
};

export function normalizePricedModel(model: string) {
  return model.toLowerCase().replace(/^models\//, "");
}

export function getModelPrice(model: string): ModelPrice | null {
  return MODEL_PRICES[normalizePricedModel(model)] ?? null;
}
