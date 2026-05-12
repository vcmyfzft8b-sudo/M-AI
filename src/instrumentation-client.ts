import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const isDevelopment = process.env.NODE_ENV === "development";

type SentryLikeEvent = {
  breadcrumbs?: Array<{
    category?: string;
    data?: Record<string, unknown>;
    level?: string;
    message?: string | null;
  }>;
  exception?: {
    values?: Array<{
      stacktrace?: {
        frames?: unknown[];
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

function shouldDropInterruptedLoadFailedEvent(event: SentryLikeEvent) {
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

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    process.env.NEXT_PUBLIC_VERCEL_ENV ??
    process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: isDevelopment ? 1.0 : 0.1,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  ],
  replaysSessionSampleRate: isDevelopment ? 0.1 : 0,
  replaysOnErrorSampleRate: 1.0,
  beforeSend(event) {
    if (shouldDropInterruptedLoadFailedEvent(event)) {
      return null;
    }

    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
