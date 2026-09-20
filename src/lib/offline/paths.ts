/**
 * What a URL means once the network is gone.
 *
 * The service worker answers *every* failed navigation with the one cached
 * offline document, so that document has to work out for itself which screen
 * was being asked for. It does that from `location.pathname`, which the browser
 * leaves untouched — the response was substituted, the address was not.
 *
 * Plain functions, no React and no DOM, so the service worker and the tests can
 * use the same rules as the page.
 */
export type OfflineRoute =
  | { kind: "home" }
  | { kind: "lecture"; lectureId: string }
  /** Signed in or not, this screen cannot be drawn from a snapshot. */
  | { kind: "unavailable"; backToHome: boolean };

/** Where the wrapper starts, and where a signed-in session is resumed from. */
const SESSION_ENTRY_PATHS = new Set(["/", "/auth/continue", "/app/start", "/offline"]);

function stripTrailingSlash(pathname: string) {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function resolveOfflineRoute(rawPathname: string): OfflineRoute {
  const pathname = stripTrailingSlash(rawPathname.split(/[?#]/)[0] || "/");

  if (pathname === "/app" || SESSION_ENTRY_PATHS.has(pathname)) {
    return { kind: "home" };
  }

  const lecture = /^\/app\/lectures\/([^/]+)$/.exec(pathname);

  if (lecture) {
    return { kind: "lecture", lectureId: decodeURIComponent(lecture[1]) };
  }

  return { kind: "unavailable", backToHome: pathname.startsWith("/app") };
}

/**
 * True for a path the offline document can render something real for, so the
 * app knows whether to navigate there at all while it is offline.
 */
export function canRenderOffline(pathname: string) {
  return resolveOfflineRoute(pathname).kind !== "unavailable";
}
