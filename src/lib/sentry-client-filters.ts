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

function isFrameLocationUnknown(filename: string) {
  return filename === "" || filename === "<anonymous>" || filename === "[native code]";
}

export function shouldDropWebViewInjectedScriptError(event: SentryLikeEvent) {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames;

  if (!frames || frames.length === 0) {
    return false;
  }

  let sawInjectedFrame = false;

  for (const frame of frames) {
    const filename = typeof frame?.filename === "string" ? frame.filename : "";

    if (INJECTED_SCRIPT_URL.test(filename)) {
      sawInjectedFrame = true;
    } else if (!isFrameLocationUnknown(filename)) {
      // A frame from a real script (https, or our rewritten app:///_next bundle) means
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
