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

/**
 * Whether a tap has to leave through the document rather than through the
 * router. Two states answer yes, for two different reasons.
 *
 * Offline, it is the *destination* the router cannot reach: a client-side
 * navigation fetches the route's payload from the server, which is a request
 * that cannot be made, and the tap ends in a failed transition. A document
 * request is one the service worker can answer from the cache.
 *
 * In the cached shell it is this *document* that cannot be carried on with,
 * and that stays true after the connection comes back. The shell was rendered
 * at `/offline` and served under the address that was asked for, so its router
 * holds the tree of a route nobody is looking at, and its screens are drawn
 * from a snapshot rather than from the account — the shell's home screen says
 * no note can be created whatever the account is entitled to. Routing on from
 * there asks the server a question the shell has already answered wrongly: a
 * paid account that taps create is sent to the upgrade screen, which redirects
 * it straight back to the address the shell is already on, and the router
 * bounces between the two until the engine stops it (WebKit: "Attempt to use
 * history.replaceState() more than 100 times per 10 seconds"), taking the app
 * down with it. Leaving through the document ends the shell instead and puts
 * the reader on the page the server renders — which is what coming back online
 * is supposed to do anyway.
 *
 * The demo is excluded because its whole library lives in memory, which a
 * document navigation would throw away.
 */
export function needsDocumentNavigation(params: {
  href: string;
  isOffline: boolean;
  /** True when this document is the cached shell rather than a server render. */
  isShell: boolean;
  inCreatorDemo: boolean;
  /** Nothing can answer a document request offline without a worker in front of it. */
  hasServiceWorker: boolean;
}) {
  if (params.inCreatorDemo || !params.href.startsWith("/")) {
    return false;
  }

  return params.isOffline ? params.hasServiceWorker : params.isShell;
}
