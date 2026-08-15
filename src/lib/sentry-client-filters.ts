// Client-side Sentry noise filters. Each predicate answers "is this event noise we
// should drop before it leaves the browser?" for one known non-actionable error class.

export type SentryLikeEvent = {
  breadcrumbs?: Array<{
    category?: string;
    data?: Record<string, unknown>;
    level?: string;
    message?: string | null;
  }>;
  exception?: {
    values?: Array<{
      mechanism?: { type?: string } | null;
      stacktrace?: {
        frames?: Array<{ filename?: string | null }>;
      };
      type?: string;
      value?: string;
    }>;
  };
};

function isInterruptedFetchBreadcrumb(breadcrumb: NonNullable<SentryLikeEvent["breadcrumbs"]>[number]) {
  const method = typeof breadcrumb.data?.method === "string" ? breadcrumb.data.method : null;
  const url = typeof breadcrumb.data?.url === "string" ? breadcrumb.data.url : null;

  return (
    breadcrumb.category === "fetch" &&
    breadcrumb.level === "error" &&
    method != null &&
    url != null &&
    breadcrumb.data?.status_code == null
  );
}

export function shouldDropInterruptedLoadFailedEvent(event: SentryLikeEvent) {
  const exception = event.exception?.values?.[0];

  if (
    exception?.type !== "TypeError" ||
    exception.value !== "Load failed" ||
    (exception.stacktrace?.frames?.length ?? 0) > 0
  ) {
    return false;
  }

  return event.breadcrumbs?.some(isInterruptedFetchBreadcrumb) ?? false;
}

function hasNoStackFrames(
  exception: NonNullable<NonNullable<SentryLikeEvent["exception"]>["values"]>[number],
) {
  return (exception.stacktrace?.frames?.length ?? 0) === 0;
}

function hasBrowserNavigationBreadcrumb(event: SentryLikeEvent) {
  return event.breadcrumbs?.some((breadcrumb) => {
    if (breadcrumb.category === "navigation") {
      return true;
    }

    if (breadcrumb.category !== "fetch") {
      return false;
    }

    const url = typeof breadcrumb.data?.url === "string" ? breadcrumb.data.url : "";
    return url.includes("_rsc=") || url.startsWith("/api/lectures/");
  }) ?? false;
}

export function shouldDropNoStackBrowserNetworkNoise(event: SentryLikeEvent) {
  const exception = event.exception?.values?.[0];

  if (!exception || !hasNoStackFrames(exception)) {
    return false;
  }

  if (
    exception.type === "TypeError" &&
    (exception.value === "Load failed" || exception.value === "network error") &&
    hasBrowserNavigationBreadcrumb(event)
  ) {
    return true;
  }

  if (
    exception.type === "Error" &&
    exception.value === "Connection closed." &&
    hasBrowserNavigationBreadcrumb(event)
  ) {
    return true;
  }

  return false;
}

// In-app browsers (Instagram, Facebook, and similar Android WebView hosts) inject their
// own scripts into every page under an app://<script-name> pseudo-URL — e.g. Instagram's
// "app://navigation_performance_logger_android" performance logger, which throws
// "Error invoking postMessage: Java object is gone" when its native bridge is torn down
// mid-navigation.
//
// Careful: the Sentry Next.js SDK's frame normalization renames OUR OWN bundle frames
// to "app:///_next/..." — same scheme, but with an empty host and a real path (triple
// slash). Injected scripts are hostname-only pseudo-URLs: they reach beforeSend either
// verbatim ("app://navigation_performance_logger_android", non-empty host) or collapsed
// to a bare "app://" when normalization strips the host. Both are foreign; a first-party
// frame always keeps its /_next path.
const INJECTED_SCRIPT_URL = /^app:\/\/(?:[^/]|$)/;

// The other shape the same problem takes: a frame that reaches beforeSend as "app:///<path>".
// Two unrelated kinds of foreign code end up looking like that.
//
//   * A script evaluated *in* the page rather than loaded from a URL has no source URL of its
//     own, so the engine attributes its frames to the HTML document — which rewriteFrames then
//     renames like any other same-origin URL, giving "app:///", "app:///app" or
//     "app:///app/lectures/<id>". This is what iOS WebView hosts produce: the Instagram in-app
//     browser's sendDataToNative logger (MEMOAI-WEB-2C), and Chrome on iOS blowing its stack
//     inside its own injected bundle (MEMOAI-WEB-2G).
//   * A script loaded from a URL that is not ours at all. The Next.js SDK's frame normalization
//     runs `new URL(filename)` and replaces whatever origin it finds with "app://" — *every*
//     well-formed URL, not only same-origin ones. So a browser extension's injected script at
//     <some-origin>/executors/200.js arrives as "app:///executors/200.js", wearing the exact
//     scheme our own bundles wear (MEMOAI-WEB-2H, the Exodus wallet extension's provider).
//
// One question answers both: is the path something we actually serve? Every script we ship
// lives under /_next (our bundles), /_vercel (the Vercel analytics beacon) or /vendor (the
// ffmpeg core in public/) — and the one piece of JavaScript inlined in our documents is the
// ~10-line theme-restore snippet in the root layout, whose whole body sits inside a try/catch.
// An app:/// frame pointing anywhere else is therefore never our code, whatever it ends in.
const REWRITTEN_ORIGIN_URL = /^app:\/\/\//;
const OUR_SCRIPT_PATH = /^\/(?:_next|_vercel|vendor)\//;

function isForeignRewrittenFrame(filename: string) {
  if (!REWRITTEN_ORIGIN_URL.test(filename)) {
    return false;
  }

  const path = filename.slice("app://".length).split(/[?#]/)[0];
  return !OUR_SCRIPT_PATH.test(path);
}

// When an injected script registers a listener, Sentry's own browserApiErrors integration
// wraps it, so a throw from that listener is reported with the SDK's `sentryWrapped` shim as
// the outermost frame — above the injected script's own frames. At beforeSend time that shim
// is still an unresolved bundle URL ("app:///_next/static/chunks/8105-<hash>.js"); Sentry only
// resolves it to node_modules/@sentry/browser server-side, so we cannot recognize it by
// filename. What does identify it is the mechanism: these types are set exclusively by the SDK
// when it catches a throw out of a callback it wrapped (addEventListener, handleEvent,
// setTimeout, requestAnimationFrame, XHR handlers). Such a frame is instrumentation, not our
// code, so it must not count as "our code is on the stack".
const SDK_WRAPPED_CALLBACK_MECHANISM = /^auto\.browser\.browserapierrors(?:\.|$)/;

function isFrameLocationUnknown(filename: string) {
  return filename === "" || filename === "<anonymous>" || filename === "[native code]";
}

export function shouldDropWebViewInjectedScriptError(event: SentryLikeEvent) {
  const exception = event.exception?.values?.[0];
  const frames = exception?.stacktrace?.frames;

  if (!frames || frames.length === 0) {
    return false;
  }

  // Frames run outermost-caller first, so the SDK shim — when there is one — is frames[0].
  const callerFrames = SDK_WRAPPED_CALLBACK_MECHANISM.test(exception?.mechanism?.type ?? "")
    ? frames.slice(1)
    : frames;

  let sawInjectedFrame = false;

  for (const frame of callerFrames) {
    const filename = typeof frame?.filename === "string" ? frame.filename : "";

    if (INJECTED_SCRIPT_URL.test(filename) || isForeignRewrittenFrame(filename)) {
      sawInjectedFrame = true;
    } else if (!isFrameLocationUnknown(filename)) {
      // A frame from a script we serve (https, or our rewritten app:///_next bundle) means
      // our code is on the stack — keep the event.
      return false;
    }
  }

  return sawInjectedFrame;
}

export function shouldDropClientErrorEvent(event: SentryLikeEvent) {
  return (
    shouldDropInterruptedLoadFailedEvent(event) ||
    shouldDropNoStackBrowserNetworkNoise(event) ||
    shouldDropWebViewInjectedScriptError(event)
  );
}
