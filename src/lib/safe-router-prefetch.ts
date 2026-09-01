import { mapAppHrefForClient } from "@/lib/creator-demo/paths";

type PrefetchRouter = {
  prefetch: (...args: never[]) => void | Promise<void>;
};

type SafeRouterPrefetchOptions = {
  /** Fetch the complete RSC payload, including dynamic page data. */
  full?: boolean;
  /** Called once when Next.js evicts or invalidates this entry. */
  onInvalidate?: () => void;
};

type NextPrefetch = (
  href: string,
  options?: {
    kind?: "auto" | "full";
    onInvalidate?: () => void;
  },
) => void | Promise<void>;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    Boolean(value) &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function safeRouterPrefetch(
  router: PrefetchRouter,
  href: string,
  options: SafeRouterPrefetchOptions = {},
) {
  try {
    const prefetch = router.prefetch as unknown as NextPrefetch;
    const mappedHref = mapAppHrefForClient(href);
    /*
     * `router.prefetch()` defaults to Next's automatic strategy, which only
     * fetches the loading boundary for dynamic routes. `kind: "full"` is the
     * imperative equivalent of `<Link prefetch={true}>`: it stores the actual
     * page RSC payload in the client router cache, so the tap can render it
     * without waiting on another server roundtrip.
     */
    const result =
      options.full || options.onInvalidate
        ? prefetch(mappedHref, {
            kind: options.full ? "full" : "auto",
            onInvalidate: options.onInvalidate,
          })
        : prefetch(mappedHref);

    if (isPromiseLike(result)) {
      void Promise.resolve(result).catch(() => null);
    }
  } catch {
    // Prefetch is an optimization. Navigation can still happen normally if it fails.
  }
}
