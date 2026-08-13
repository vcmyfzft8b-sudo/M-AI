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
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
      block: [".note-read-content", ".lecture-markdown"],
    }),
  ],
  replaysSessionSampleRate: isDevelopment ? 0.1 : 0,
  replaysOnErrorSampleRate: 1.0,
  beforeSend(event) {
    if (shouldDropClientErrorEvent(event)) {
      return null;
    }

    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
