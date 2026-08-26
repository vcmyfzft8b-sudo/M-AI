// Kept free of "server-only" so the abort contract stays unit-testable
// (tests/invocation-budget.test.mjs) outside the Next.js runtime.

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Carries the invocation's abort signal to every AI call made underneath it without threading a
 * parameter through the whole pipeline. The alternative was measured in production on 2026-08-25:
 * `runWithinInvocationBudget` rejects its `Promise.race` when the budget runs out, but the losing
 * pipeline kept executing on the warm instance — completing, saving notes, and buying thousands of
 * Gemini calls — while the caller had already reported failure and triggered a retry that started
 * the same work again. Up to three of those zombie pipelines ran concurrently for two hours.
 *
 * The store survives `await` boundaries (AsyncLocalStorage follows the async context), so a signal
 * installed around the pipeline entry point is visible inside every extraction worker.
 */
type AbortContext = {
  signal: AbortSignal;
  /** Epoch ms when the surrounding budget will fire, when the caller knows it. */
  deadlineAt?: number;
};

const abortContextStore = new AsyncLocalStorage<AbortContext>();

export function runWithAbortSignal<T>(
  signal: AbortSignal,
  run: () => Promise<T>,
  options?: { deadlineAt?: number },
): Promise<T> {
  return abortContextStore.run({ signal, deadlineAt: options?.deadlineAt }, run);
}

export function getCurrentAbortSignal(): AbortSignal | undefined {
  return abortContextStore.getStore()?.signal;
}

/**
 * Milliseconds until the surrounding budget fires, or undefined outside any budget. Lets a call
 * clamp its own timeout to the time that actually exists: an attempt started with 35s left and a
 * 240s timeout is a paid-for request whose answer nothing will ever read.
 */
export function getRemainingBudgetMs(): number | undefined {
  const deadlineAt = abortContextStore.getStore()?.deadlineAt;

  return deadlineAt == null ? undefined : Math.max(0, deadlineAt - Date.now());
}

export function isCurrentWorkAborted() {
  return abortContextStore.getStore()?.signal.aborted ?? false;
}

export class WorkAbortedError extends Error {
  constructor(message = "The invocation budget ran out; remaining work was cancelled.") {
    super(message);
    this.name = "WorkAbortedError";
  }
}

/** Throws when the surrounding invocation has run out of budget; a no-op outside any budget. */
export function throwIfCurrentWorkAborted() {
  if (isCurrentWorkAborted()) {
    throw new WorkAbortedError();
  }
}

export function isWorkAbortedError(error: unknown) {
  return (
    error instanceof WorkAbortedError ||
    (error instanceof Error &&
      (error.name === "WorkAbortedError" || error.name === "AbortError"))
  );
}
