/**
 * The creator demo mounts the real app UI under `/creator` so UGC recordings
 * can show the product without an account. The app components hardcode `/app`
 * hrefs, so every link/navigation they produce is rewritten to the demo base
 * path before it reaches the router.
 *
 * Render-time mapping goes through the React context in
 * `@/components/creator-demo/creator-demo-context`, so server and client render
 * the same markup. This module only holds the client-side mirror of that flag,
 * which imperative helpers (prefetch, fetch stub) read outside of React.
 */
export const CREATOR_DEMO_BASE_PATH = "/creator";

let clientDemoActive = false;

/** Client-only. Never call this while rendering on the server. */
export function setCreatorDemoClientActive(active: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  clientDemoActive = active;
}

export function isCreatorDemoClientActive() {
  return clientDemoActive;
}

/** `/app/lectures/1` -> `/creator/lectures/1` for the given base path. */
export function mapAppHref(href: string, basePath: string | null) {
  if (!basePath || typeof href !== "string" || !href.startsWith("/app")) {
    return href;
  }

  const rest = href.slice("/app".length);

  if (rest === "" || rest.startsWith("/") || rest.startsWith("?") || rest.startsWith("#")) {
    return `${basePath}${rest}`;
  }

  return href;
}

/** `/creator/lectures/1` -> `/app/lectures/1`, so `/app` route logic keeps working. */
export function unmapDemoPathname(pathname: string, basePath: string | null) {
  if (!basePath || typeof pathname !== "string" || !pathname.startsWith(basePath)) {
    return pathname;
  }

  const rest = pathname.slice(basePath.length);

  if (rest === "" || rest.startsWith("/")) {
    return `/app${rest}`;
  }

  return pathname;
}

/** Imperative variant for helpers that run outside the React tree. */
export function mapAppHrefForClient(href: string) {
  return mapAppHref(href, clientDemoActive ? CREATOR_DEMO_BASE_PATH : null);
}
