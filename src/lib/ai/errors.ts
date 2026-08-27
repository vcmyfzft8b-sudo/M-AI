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

// The two failures we word ourselves, named because `toUserFacingAiErrorMessage` is not always
// the last thing that touches an error: the scan rescue path rethrows its result as a fresh
// `new Error(message)`, so anything downstream that asks `isRetryableAiError` about that error
// sees only this text. The English "temporarily overloaded" answered "retryable" by accident,
// through the provider keyword it happened to contain; the Slovenian wording would not, so the
// classifier below matches that sentence by name and the verdict survives the translation.
export const AI_SAVE_TIMEOUT_MESSAGE =
  "Shranjevanje zapiskov je trajalo predolgo. Poskusi znova čez minuto.";
export const AI_PROVIDER_OVERLOADED_MESSAGE =
  "Naš ponudnik UI je trenutno preobremenjen. Poskusi znova čez minuto.";

// Only the overloaded sentence, deliberately. The English wording of the save-timeout message
// contained no provider keyword, so it classified as NOT retryable, and mapping it to retryable
// now would be a behaviour change rather than a translation.
export function isRetryableAiError(error: unknown) {
  const message = getErrorText(error).toLowerCase();

  if (message.includes(AI_PROVIDER_OVERLOADED_MESSAGE.toLowerCase())) {
    return true;
  }

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
    message.includes("timeout")
  );
}

export function toUserFacingAiErrorMessage(error: unknown) {
  const text = getErrorText(error);
  const message = text.toLowerCase();

  // Idempotent: the scan rescue path rethrows this function's own output as a fresh Error, so
  // the same text can arrive here twice. Without this, the second pass would match the
  // save-timeout sentence against the overloaded rule and swap one message for the other.
  if (text.trim() === AI_SAVE_TIMEOUT_MESSAGE || text.trim() === AI_PROVIDER_OVERLOADED_MESSAGE) {
    return text.trim();
  }

  if (
    message.includes("statement timeout") ||
    message.includes("canceling statement due to statement timeout")
  ) {
    return AI_SAVE_TIMEOUT_MESSAGE;
  }

  if (isRetryableAiError(error)) {
    return AI_PROVIDER_OVERLOADED_MESSAGE;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Pri obdelavi je prišlo do nepričakovane napake.";
}
