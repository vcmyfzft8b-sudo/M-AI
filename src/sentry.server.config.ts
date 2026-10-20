import * as Sentry from "@sentry/nextjs";

import { groupProviderBillingEvent } from "@/lib/sentry-server-filters";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
const isDevelopment = process.env.NODE_ENV === "development";

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment:
    process.env.SENTRY_ENVIRONMENT ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: isDevelopment ? 1.0 : 0.1,
  enableLogs: true,
  // One issue for the Gemini spend cap, however many routes it stops (src/lib/sentry-server-filters.ts).
  beforeSend: (event, hint) => groupProviderBillingEvent(event, hint),
});
