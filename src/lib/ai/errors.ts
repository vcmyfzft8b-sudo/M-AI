function getErrorText(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    // `JSON.stringify(undefined)` is `undefined`, not a string, and every caller here goes
    // straight on to `.toLowerCase()` or `.trim()`. This function feeds the message that records
    // a pipeline failure, so it must never be the thing that throws.
    return JSON.stringify(error) ?? String(error);
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
// The sentence `runWithinInvocationBudget` already rejects with when a stage outlives its budget.
// Repeated here rather than imported from the five call sites that declare it, because those live
// in route modules this dependency-free file must not pull in; tests/aborted-run-message.test.mjs
// fails if any of them drifts from this one.
export const AI_PROCESSING_TOO_LONG_MESSAGE =
  "Obdelava je trajala predolgo in se je ustavila. Poskusi znova.";

/**
 * An abort inside the pipeline means exactly one thing: the invocation budget ran out and
 * cancelled the work still in flight (see src/lib/abort-context.ts). The budget's own rejection
 * normally wins the race and carries `AI_PROCESSING_TOO_LONG_MESSAGE`, but on 2026-08-27 a
 * cancelled call's rejection reached `markLecturePipelineFailed` first, and its raw text — Node's
 * `DOMException: This operation was aborted` — was written to the lecture as the learner's error
 * message and opened a Sentry issue of its own (MEMOAI-WEB-34).
 *
 * Recognised by `name` first. The message test is not a convenience: `markLecturePipelineFailed`
 * is called on the far side of an Inngest step boundary, which rebuilds the error as a plain
 * `Error` and leaves nothing but the message to go on. Both strings matched here are fixed — one
 * is Node's own default abort reason, the other is `WorkAbortedError`'s own wording — not a
 * provider's prose that could be reworded upstream.
 */
export function isAbortedWorkError(error: unknown) {
  const name =
    error instanceof Error
      ? error.name
      : typeof error === "object" && error !== null && "name" in error
        ? (error as { name?: unknown }).name
        : null;

  if (name === "AbortError" || name === "WorkAbortedError") {
    return true;
  }

  const text = getErrorText(error).trim();

  return (
    /^this operation was aborted\.?$/i.test(text) ||
    text.toLowerCase().includes("the invocation budget ran out")
  );
}

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

  // Before the keyword rules below: a cancelled run is the budget ending, and the learner is owed
  // the budget's own sentence rather than Node's English abort text. It is the same outcome the
  // budget reports when its rejection wins the race, so the two paths now read identically.
  if (isAbortedWorkError(error)) {
    return AI_PROCESSING_TOO_LONG_MESSAGE;
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
