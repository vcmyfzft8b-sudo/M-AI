/**
 * What to put on screen when a request failed.
 *
 * Almost every failure in this app is written by the server, already in the
 * reader's language, and the right thing to do with it is show it. The one
 * exception is a `fetch` that never reached a server at all: its message is
 * whatever the browser engine happens to call the failure — "Failed to fetch"
 * in Chrome, "Load failed" in Safari — which is English, unexplained, and looks
 * like a crash rather than a dropped connection.
 *
 * Shared because both chats need it and only one of them had it: the library
 * chat showed Safari's "Load failed" verbatim to Slovenian learners.
 */
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";

/**
 * The one error whose text is decided here rather than by the server. Resolved
 * through the caller's `t` so it arrives in the reader's language like every
 * other failure on the screen.
 */
export const NETWORK_REQUEST_ERROR_KEY = "error.network" satisfies MessageKey;

export function isInterruptedFetchError(error: unknown) {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError" || error.name === "NetworkError";
  }

  return error instanceof TypeError && /failed to fetch|load failed|network/i.test(error.message);
}

export function getRequestErrorMessage(
  error: unknown,
  fallback: string,
  t: Translate<MessageKey>,
) {
  if (isInterruptedFetchError(error)) {
    return t(NETWORK_REQUEST_ERROR_KEY);
  }

  return error instanceof Error ? error.message : fallback;
}
