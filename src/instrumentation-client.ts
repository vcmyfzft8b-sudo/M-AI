import * as Sentry from "@sentry/nextjs";

import { shouldDropClientErrorEvent } from "@/lib/sentry-client-filters";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const isDevelopment = process.env.NODE_ENV === "development";

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    process.env.NEXT_PUBLIC_VERCEL_ENV ??
    process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: isDevelopment ? 1.0 : 0.1,
  // Session replay records user activity even when text and media are masked.
  // Keep it disabled until there is explicit consent and a recording indicator.
  // Error reports and performance traces remain enabled independently.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  beforeSend(event) {
    if (shouldDropClientErrorEvent(event)) {
      return null;
    }

    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
