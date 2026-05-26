type PrefetchRouter = {
  prefetch: (href: string) => void | Promise<void>;
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    Boolean(value) &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function safeRouterPrefetch(router: PrefetchRouter, href: string) {
  try {
    const result = router.prefetch(href);

    if (isPromiseLike(result)) {
      void Promise.resolve(result).catch(() => null);
    }
  } catch {
    // Prefetch is an optimization. Navigation can still happen normally if it fails.
  }
}
