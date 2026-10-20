// Imported by its real filename so the Node test runner can load this module directly.
import { GEMINI_SPEND_CAP_ISSUE_TITLE, isAiProviderSpendCapError } from "./ai/errors.ts";

/**
 * Server-side Sentry event shaping, wired into `beforeSend` in src/sentry.server.config.ts.
 *
 * Kept free of the SDK so it can be tested as plain data: the shape below is the part of an
 * `ErrorEvent` this reads and writes, nothing more.
 */
type SentryEventLike = {
  message?: string;
  fingerprint?: string[];
  tags?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  exception?: { values?: Array<{ type?: string; value?: string }> };
};

/** Every spend-cap event lands in this one issue, whatever route or stack raised it. */
export const GEMINI_SPEND_CAP_FINGERPRINT = ["gemini-monthly-spending-cap"];

/** `AiProviderSpendCapError`'s name, which becomes the issue's type. */
const SPEND_CAP_ERROR_TYPE = "AiProviderSpendCapError";

function mentionsSpendCap(event: SentryEventLike, originalException: unknown) {
  if (originalException !== undefined && isAiProviderSpendCapError(originalException)) {
    return true;
  }

  const values = event.exception?.values ?? [];

  return (
    (event.message !== undefined && isAiProviderSpendCapError(event.message)) ||
    values.some(
      (value) =>
        value.type === SPEND_CAP_ERROR_TYPE ||
        (value.value !== undefined && isAiProviderSpendCapError(value.value)),
    )
  );
}

/**
 * Files the Gemini spend cap under one issue.
 *
 * On 2026-10-20 one cause opened four: the scan route's rethrown learner sentence
 * (MEMOAI-WEB-63), the document route's raw `ApiError` (-64), Inngest's flattened copy of the
 * embeddings error (-65) and the tutor's speech failure (-66). Each had a different stack and a
 * different first line, so Sentry grouped them apart and none of them said "spend cap" in its
 * title. The cap is one thing with one fix — raise it at https://ai.studio/spend — so it gets one
 * issue with that name, and Google's own sentence is kept on the event for whoever opens it.
 */
export function groupProviderBillingEvent<T extends SentryEventLike>(
  event: T,
  hint?: { originalException?: unknown },
): T {
  if (!mentionsSpendCap(event, hint?.originalException)) {
    return event;
  }

  const last = event.exception?.values?.at(-1);
  const providerMessage = last?.value ?? event.message ?? null;

  if (last) {
    last.type = SPEND_CAP_ERROR_TYPE;
    last.value = GEMINI_SPEND_CAP_ISSUE_TITLE;
  }

  event.fingerprint = [...GEMINI_SPEND_CAP_FINGERPRINT];
  event.tags = { ...event.tags, ai_provider_billing: "gemini_spend_cap" };
  event.extra = { ...event.extra, providerMessage };

  return event;
}
