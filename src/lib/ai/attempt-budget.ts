// Kept free of "server-only" so the deadline arithmetic stays unit-testable outside Next.js.

/** OpenRouter's own default when a stage has not measured a narrower timeout. */
export const OPENROUTER_DEFAULT_TIMEOUT_MS = 180_000;
/** Direct Gemini's normal structured-generation window. */
export const STRUCTURED_FALLBACK_RESERVE_MS = 90_000;

/** An attempt smaller than this is too unlikely to finish to be worth starting. */
const MIN_ATTEMPT_BUDGET_MS = 15_000;
/** Room for parsing, logging and the next tier's hand-off. */
const ATTEMPT_BUDGET_MARGIN_MS = 5_000;

export class AiAttemptBudgetUnavailableError extends Error {
  constructor() {
    super("The invocation does not have enough time left to start this model tier.");
    this.name = "AiAttemptBudgetUnavailableError";
  }
}

/**
 * Clamp one model call to the wall-clock time that really exists.
 *
 * `fallbackReserveMs` belongs to the next tier, not this one. Pooled study generation can spend
 * a substantial part of its invocation preparing and checkpointing batches before the first
 * model call starts. Reserving the fallback here means a slow primary cannot consume the only
 * time in which its fallback could answer.
 */
export function resolveAiAttemptTimeoutMs(params: {
  requestedTimeoutMs: number;
  remainingBudgetMs: number | undefined;
  fallbackReserveMs?: number;
}) {
  if (params.remainingBudgetMs == null) {
    return params.requestedTimeoutMs;
  }

  const usableMs =
    params.remainingBudgetMs -
    (params.fallbackReserveMs ?? 0) -
    ATTEMPT_BUDGET_MARGIN_MS;

  if (usableMs < MIN_ATTEMPT_BUDGET_MS) {
    return null;
  }

  return Math.min(params.requestedTimeoutMs, usableMs);
}

/**
 * The primary keeps OpenRouter's default unless its stage measured something else. A routed
 * fallback gets the same 90s window as the direct Gemini tier it mirrors; inheriting the
 * primary's 180s default would let the fallback consume the time reserved for recovery.
 */
export function resolveOpenRouterTierTimeoutMs(params: {
  stageTimeoutMs: number | undefined;
  tierIndex: number;
}) {
  return (
    params.stageTimeoutMs ??
    (params.tierIndex > 0 ? STRUCTURED_FALLBACK_RESERVE_MS : OPENROUTER_DEFAULT_TIMEOUT_MS)
  );
}
