import * as Sentry from "@sentry/nextjs";
import { isNativeUserAgent } from "@/lib/mobile/runtime";

import { shouldDropClientErrorEvent } from "@/lib/sentry-client-filters";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const isDevelopment = process.env.NODE_ENV === "development";

const nativeApp = typeof navigator !== "undefined" && isNativeUserAgent(navigator.userAgent);

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    process.env.NEXT_PUBLIC_VERCEL_ENV ??
    process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: isDevelopment ? 1.0 : 0.1,
  // The website keeps its masked replay of the moments before an error. The
  // iOS app does not replay at all: its App Store privacy answers say so.
  // Error reports and performance traces run in both.
  integrations: nativeApp ? [] : [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
      block: [".note-read-content", ".lecture-markdown"],
    }),
  ],
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: nativeApp ? 0 : 1.0,
  beforeSend(event) {
    if (shouldDropClientErrorEvent(event)) {
      return null;
    }

    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
