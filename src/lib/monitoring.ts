import "server-only";

import * as Sentry from "@sentry/nextjs";

type CaptureRouteErrorContext = {
  route: string;
  operation: string;
  request?: Request;
  userId?: string;
  lectureId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

export function captureRouteError(
  error: unknown,
  {
    route,
    operation,
    request,
    userId,
    lectureId,
    tags,
    extra,
  }: CaptureRouteErrorContext,
) {
  Sentry.withScope((scope) => {
    scope.setTag("route", route);
    scope.setTag("operation", operation);

    if (lectureId) {
      scope.setTag("lectureId", lectureId);
    }

    if (tags) {
      for (const [key, value] of Object.entries(tags)) {
        scope.setTag(key, value);
      }
    }

    if (userId) {
      scope.setUser({ id: userId });
    }

    if (request) {
      scope.setContext("request", {
        method: request.method,
        path: new URL(request.url).pathname,
        vercelRequestId: request.headers.get("x-vercel-id"),
      });
    }

    if (extra) {
      scope.setContext("route", extra);
    }

    Sentry.captureException(toError(error));
  });
}

type CaptureBackgroundErrorContext = {
  operation: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

/**
 * Reports a failure that the caller deliberately swallows, so the import still finishes on a
 * degraded result. These never reach captureRouteError — nothing throws to a route — which is how
 * PPTX visual extraction (#101) and document image descriptions (#138) each stayed broken for
 * months behind a console.warn nobody read.
 * Sent as a warning: the request succeeded, but a piece of it silently did not.
 */
export function captureBackgroundError(
  error: unknown,
  { operation, tags, extra }: CaptureBackgroundErrorContext,
) {
  Sentry.withScope((scope) => {
    scope.setLevel("warning");
    scope.setTag("operation", operation);

    if (tags) {
      for (const [key, value] of Object.entries(tags)) {
        scope.setTag(key, value);
      }
    }

    if (extra) {
      scope.setContext("background", extra);
    }

    Sentry.captureException(toError(error));
  });
}

function toError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  if (hasMessage(error)) {
    const wrapped = new Error(String(error.message));

    if ("name" in error && typeof error.name === "string") {
      wrapped.name = error.name;
    }

    return wrapped;
  }

  return new Error(typeof error === "string" ? error : "Unknown route error");
}

function hasMessage(error: unknown): error is { message: unknown; name?: unknown } {
  return typeof error === "object" && error !== null && "message" in error;
}
