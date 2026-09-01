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
/*
 * A second reason these stay in one language: the reader does not see them.
 *
 * They are written into the lecture row's `error_message` by a background run
 * that has no reader and no request, so they cannot know which of five
 * languages to use. `toAiFailureCode` below turns each of them back into a
 * code, the pipeline records that code, and the note screen resolves it into
 * the reader's own language at render time. What is left here is an internal
 * marker — for the classifier above, for Sentry, and for anyone reading the
 * table — and must not be translated, or the classifier stops recognising it.
 */
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
 * `Error` and leaves nothing but the message to go on. Both patterns matched here are fixed — one
 * is Node's own default abort reason, the other is `WorkAbortedError`'s own wording — not a
 * provider's prose that could be reworded upstream.
 *
 * `WorkAbortedError` is thrown with more than one sentence, so the second pattern matches the
 * phrase they share rather than any single one of them. Matching only "the invocation budget ran
 * out" missed the attempt-timeout clamp in src/lib/ai/gemini.ts, which declines to start a call
 * that cannot finish and says so in its own words ("...is nearly spent..."). On 2026-09-01 that
 * sentence crossed a step boundary, failed every test here, and was written to a learner's lecture
 * verbatim, in English — the same failure this function was written for (issue 144291117).
 * tests/aborted-run-message.test.mjs scans both modules and fails if any sentence stops matching.
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
    text.toLowerCase().includes("the invocation budget")
  );
}

// What the learner reads when the pipeline has proven — not guessed — that their material cannot
// be processed in one piece: the run overran its budget, was retried automatically, and overran
// again. Deliberately free of every keyword `isRetryableAiError` matches, so a rethrow of this
// exact sentence keeps classifying as not retryable.
export const AI_SOURCE_TOO_EXTENSIVE_MESSAGE =
  "Gradivo je preobsežno, da bi ga obdelali v enem kosu. Razdeli ga na manjše dele in vsak del dodaj kot svoj zapisek.";

/**
 * The whole budget-overrun family, whichever side of the race surfaced it: the budget's own
 * rejection (`InvocationBudgetExceededError`, or just its Slovene sentence once an Inngest step
 * boundary has flattened the class away) and the cancelled work's rejection (`isAbortedWorkError`).
 *
 * These are the failures where the run was healthy and simply ran out of time — measured on
 * 2026-08-28: a run that died this way finished in 80 seconds when retried, because every
 * completed stage is checkpointed. That is what makes this family, and only this family, safe to
 * retry automatically.
 */
export function isBudgetOverrunFailure(error: unknown) {
  if (error instanceof Error && error.name === "InvocationBudgetExceededError") {
    return true;
  }

  if (isAbortedWorkError(error)) {
    return true;
  }

  return getErrorText(error).trim() === AI_PROCESSING_TOO_LONG_MESSAGE;
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

  return AI_UNEXPECTED_MESSAGE;
}

/** The generic last resort, named so `toAiFailureCode` can recognise it too. */
export const AI_UNEXPECTED_MESSAGE = "Pri obdelavi je prišlo do nepričakovane napake.";

/**
 * The failure code for one of the sentences this module writes, or null for anything else.
 *
 * The pipeline asks this only after `toLectureFailureCode` has come back empty — an AI or budget
 * failure carries no `ExpectedLectureInputError`, so the sentence is the only thing left to
 * recognise it by. Matching our own constants by identity is safe in a way that matching a
 * learner-facing sentence is not: these four are never translated, precisely so that this and
 * `isRetryableAiError` keep working across an Inngest step boundary.
 */
export function toAiFailureCode(message: string): string | null {
  if (message === AI_SAVE_TIMEOUT_MESSAGE) {
    return "ai_save_timeout";
  }

  if (message === AI_PROVIDER_OVERLOADED_MESSAGE) {
    return "ai_provider_overloaded";
  }

  if (message === AI_PROCESSING_TOO_LONG_MESSAGE) {
    return "ai_processing_too_long";
  }

  if (message === AI_UNEXPECTED_MESSAGE) {
    return "ai_unexpected";
  }

  return null;
}
