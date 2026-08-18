// Vercel kills a function the moment it reaches the route's `maxDuration`, and work handed to
// `after()` dies with it: nothing throws, no catch runs, and the only trace is a "Vercel Runtime
// Timeout Error" line in the platform log that carries no lecture id. A pipeline killed that way
// leaves its lecture on an in-progress status forever, so the user watches a spinner that will
// never resolve and nothing reaches Sentry.
//
// Stopping a little short of the platform limit turns that silent kill into an ordinary rejection,
// which the caller can still record on the row while the function is alive.

/** Time left for the caller to write the failure once the budget is spent. */
export const INVOCATION_BUDGET_SAFETY_MS = 20_000;

export class InvocationBudgetExceededError extends Error {
  readonly budgetMs: number;

  constructor(message: string, budgetMs: number) {
    super(message);
    this.name = "InvocationBudgetExceededError";
    this.budgetMs = budgetMs;
  }
}

export function getInvocationBudgetMs(params: {
  maxDurationSeconds: number;
  elapsedMs: number;
  safetyMs?: number;
}) {
  const safetyMs = params.safetyMs ?? INVOCATION_BUDGET_SAFETY_MS;

  return Math.max(0, params.maxDurationSeconds * 1000 - safetyMs - params.elapsedMs);
}

export async function runWithinInvocationBudget<T>(params: {
  run: () => Promise<T>;
  budgetMs: number;
  deadlineMessage: string;
}): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      params.run(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(new InvocationBudgetExceededError(params.deadlineMessage, params.budgetMs)),
          params.budgetMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
