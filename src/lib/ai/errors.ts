function getErrorText(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function getNestedErrorDetails(error: unknown, depth = 0): { messages: string[]; codes: string[] } {
  if (!error || depth > 4) {
    return { messages: [], codes: [] };
  }

  if (typeof error === "string") {
    return { messages: [error], codes: [] };
  }

  if (typeof error !== "object") {
    return { messages: [], codes: [] };
  }

  const record = error as {
    message?: unknown;
    code?: unknown;
    cause?: unknown;
    errors?: unknown;
  };
  const details = {
    messages: typeof record.message === "string" ? [record.message] : [],
    codes: typeof record.code === "string" ? [record.code] : [],
  };
  const children = [record.cause];

  if (Array.isArray(record.errors)) {
    children.push(...record.errors);
  }

  for (const child of children) {
    const nested = getNestedErrorDetails(child, depth + 1);
    details.messages.push(...nested.messages);
    details.codes.push(...nested.codes);
  }

  return details;
}

export function isRetryableAiError(error: unknown) {
  const details = getNestedErrorDetails(error);
  const message = [getErrorText(error), ...details.messages].join(" ").toLowerCase();
  const codes = new Set(details.codes.map((code) => code.toUpperCase()));

  if (
    message.includes("statement timeout") ||
    message.includes("canceling statement due to statement timeout")
  ) {
    return false;
  }

  return (
    message.includes("503") ||
    message.includes("429") ||
    message.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("resource_exhausted") ||
    message.includes("rate limit") ||
    message.includes("try again later") ||
    message.includes("overloaded") ||
    message.includes("temporarily unavailable") ||
    message.includes("deadline exceeded") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("network error") ||
    message.includes("terminated") ||
    codes.has("ETIMEDOUT") ||
    codes.has("ECONNRESET") ||
    codes.has("ECONNREFUSED") ||
    codes.has("EAI_AGAIN") ||
    codes.has("UND_ERR_CONNECT_TIMEOUT") ||
    codes.has("UND_ERR_SOCKET")
  );
}

const GENERIC_FAILURE_MESSAGE =
  "Zapiska ni bilo mogoče obdelati. Poskusi znova ali naloži gradivo še enkrat.";

/// Provider payloads leak into `lectures.error_message`, which both the website
/// and the iOS app print verbatim on the failed-note card. A raw Gemini or
/// Supabase blob is meaningless to a student and exposes internals, so anything
/// that does not look like a sentence written for a person is replaced with a
/// generic message. The original error still reaches Sentry.
/// Replace anything that is not a sentence written for a person with a generic
/// message. Every generator that stores an error the UI renders should pass its
/// text through this, otherwise provider payloads reach the failed-note card.
export function toPresentableErrorMessage(message: string, fallback = GENERIC_FAILURE_MESSAGE) {
  return isPresentableMessage(message) ? message.trim() : fallback;
}

function isPresentableMessage(message: string) {
  const trimmed = message.trim();

  if (trimmed.length === 0 || trimmed.length > 200) {
    return false;
  }

  // Serialised payloads, stack frames, URLs and bare API/provider identifiers.
  if (/[{}[\]]|"\s*:|https?:\/\/|\bat\s+\w+\s*\(|\n/.test(trimmed)) {
    return false;
  }

  return !/\bapi[_ ]?key\b|\btoken\b|googleapis|supabase|postgres|invalid_argument|permission_denied/i.test(
    trimmed,
  );
}

export function toUserFacingAiErrorMessage(error: unknown) {
  const message = getErrorText(error).toLowerCase();

  if (
    message.includes("statement timeout") ||
    message.includes("canceling statement due to statement timeout")
  ) {
    return "Shranjevanje zapiska je trajalo predolgo. Poskusi znova čez minuto.";
  }

  if (isRetryableAiError(error)) {
    return "Storitev je trenutno preobremenjena. Poskusi znova čez minuto.";
  }

  if (error instanceof Error && isPresentableMessage(error.message)) {
    return error.message;
  }

  if (typeof error === "string" && isPresentableMessage(error)) {
    return error;
  }

  return GENERIC_FAILURE_MESSAGE;
}
