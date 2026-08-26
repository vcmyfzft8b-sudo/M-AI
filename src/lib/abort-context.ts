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
const abortSignalStore = new AsyncLocalStorage<AbortSignal>();

export function runWithAbortSignal<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  return abortSignalStore.run(signal, run);
}

export function getCurrentAbortSignal(): AbortSignal | undefined {
  return abortSignalStore.getStore();
}

export function isCurrentWorkAborted() {
  return abortSignalStore.getStore()?.aborted ?? false;
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
