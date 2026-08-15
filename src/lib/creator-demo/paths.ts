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

/**
 * A second mount of the same demo, for recordings aimed at students. It is
 * identical to `/creator` apart from the live-recording takeover, so it needs
 * its own base path to keep its notes and links inside its own tree.
 */
export const CREATOR_COLLEGE_DEMO_BASE_PATH = "/creator/college";

export type CreatorDemoVariant = "standard" | "college";

/** Which demo mount a request is inside. Nested paths win over `/creator`. */
export function resolveCreatorDemoBasePath(pathname: string) {
  return pathname === CREATOR_COLLEGE_DEMO_BASE_PATH ||
    pathname.startsWith(`${CREATOR_COLLEGE_DEMO_BASE_PATH}/`)
    ? CREATOR_COLLEGE_DEMO_BASE_PATH
    : CREATOR_DEMO_BASE_PATH;
}

export function creatorDemoVariantForBasePath(basePath: string | null): CreatorDemoVariant {
  return basePath === CREATOR_COLLEGE_DEMO_BASE_PATH ? "college" : "standard";
}

let clientBasePath: string | null = null;

/** Client-only. Never call this while rendering on the server. */
export function setCreatorDemoClientBasePath(basePath: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  clientBasePath = basePath;
}

export function isCreatorDemoClientActive() {
  return clientBasePath != null;
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
  return mapAppHref(href, clientBasePath);
}
