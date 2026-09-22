/**
 * Maps over `items` with at most `concurrency` calls in flight, keeping the
 * result order.
 *
 * Workers settle instead of rejecting: `Promise.all` over rejecting workers
 * resolves on the first rejection and leaves any later one unhandled, which
 * takes down the whole invocation. The first failure is rethrown once every
 * worker has stopped.
 */
export async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  const failures: unknown[] = [];
  let next = 0;

  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    async () => {
      while (next < items.length && failures.length === 0) {
        const index = next;
        next += 1;

        try {
          results[index] = await mapper(items[index], index);
        } catch (error) {
          failures.push(error);
          return;
        }
      }
    },
  );

  await Promise.all(workers);

  if (failures.length > 0) {
    throw failures[0];
  }

  return results;
}
