import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";

// Whether the red "Poskusi znova" button is worth offering on a failed note.
//
// Some failures are the material, not the machine: a link behind a sign-in, a page with nothing
// readable on it, a source too big to process. Retrying feeds the pipeline the identical input
// and reproduces the identical rejection, so offering retry there is offering a button that
// cannot work — the learner presses it, waits, and lands back on the same red card. Others are
// genuinely transient (a slow site, an overloaded provider) and retry is exactly right.
//
// `markLecturePipelineFailed` stamps the thrown error's code into the lecture's processing
// metadata; these helpers read it back on both surfaces that render a failure.
//
// Deliberately dependency-free apart from the message-key type, so client components can import
// it.

export const LECTURE_FAILURE_METADATA_KEY = "failure";

/**
 * The sentence a failed note shows, chosen by the code rather than read from the row.
 *
 * `error_message` is written by the pipeline, in the background, minutes or hours before anybody
 * looks at the note — so it cannot know which of five languages the reader will be using. The
 * code can: it is a stable identifier, and the wording is resolved here, at render time, in the
 * reader's own language.
 *
 * Null for a code we have no message for, and for a failure that carries no code at all — an
 * older row, or one whose class was flattened crossing an Inngest step boundary. Callers fall
 * back to the stored `error_message` there, which is the best available text even when it is in
 * the wrong language.
 */
export const LECTURE_FAILURE_MESSAGE_KEYS: Record<string, MessageKey> = {
  audio_no_clear_speech: "failure.audio_no_clear_speech",
  audio_not_decodable: "failure.audio_not_decodable",
  invalid_link_redirect: "failure.invalid_link_redirect",
  link_host_not_found: "failure.link_host_not_found",
  link_not_enough_text: "failure.link_not_enough_text",
  link_not_loadable: "failure.link_not_loadable",
  link_requires_login: "failure.link_requires_login",
  link_timeout: "failure.link_timeout",
  link_tls_failed: "failure.link_tls_failed",
  link_unreachable: "failure.link_unreachable",
  pdf_no_text: "failure.pdf_no_text",
  private_network_link: "failure.private_network_link",
  processing_stalled: "failure.processing_stalled",
  scan_not_enough_text: "failure.scan_not_enough_text",
  source_no_study_content: "failure.source_no_study_content",
  source_too_large: "failure.source_too_large",
  source_too_short: "failure.source_too_short",
  too_many_link_redirects: "failure.too_many_link_redirects",
  unsupported_link_content_type: "failure.unsupported_link_content_type",
  unsupported_link_protocol: "failure.unsupported_link_protocol",
  unsupported_video_link: "failure.unsupported_video_link",
  youtube_no_captions: "failure.youtube_no_captions",
  youtube_request_blocked: "failure.youtube_request_blocked",
  // Not input failures: the AI or budget ones, recognised from the sentences the pipeline wrote
  // (see `toAiFailureCode`). They get codes for the same reason the rest do — so the note screen
  // can show them in the reader's language rather than the run's.
  ai_save_timeout: "ai.saveTimeout",
  ai_provider_overloaded: "ai.providerOverloaded",
  ai_processing_too_long: "ai.processingTooLong",
  ai_unexpected: "ai.unexpectedError",
};

export function lectureFailureMessage(
  processingMetadata: unknown,
  t: Translate<MessageKey>,
): string | null {
  const code = readLectureFailureCode(processingMetadata);
  const key = code ? LECTURE_FAILURE_MESSAGE_KEYS[code] : undefined;

  return key ? t(key) : null;
}

/**
 * Codes whose cause travels with the input. Everything not listed here — including a failure that
 * carries no code at all — stays retryable, so the button only ever disappears where we have
 * positively established that pressing it is futile.
 *
 * `link_host_not_found` is deliberately absent even though a typo'd domain will never resolve:
 * the same code is raised for EAI_AGAIN, which is a *temporary* resolver failure, and the two are
 * indistinguishable by the time they reach here. Where the set cannot separate the permanent case
 * from the transient one, the button stays.
 */
const UNRETRYABLE_LECTURE_FAILURE_CODES = new Set([
  "audio_no_clear_speech",
  "audio_not_decodable",
  "link_not_enough_text",
  "link_requires_login",
  "private_network_link",
  "scan_not_enough_text",
  "source_no_study_content",
  "source_too_large",
  "source_too_short",
  "too_many_link_redirects",
  "unsupported_link_content_type",
  "unsupported_link_protocol",
  "unsupported_video_link",
]);

/**
 * Reads the failure code a lecture was last marked with, or null when there is none — an older
 * row written before codes were recorded, or a failure whose class was erased crossing an
 * Inngest step boundary.
 */
export function readLectureFailureCode(processingMetadata: unknown) {
  if (!processingMetadata || typeof processingMetadata !== "object" || Array.isArray(processingMetadata)) {
    return null;
  }

  const failure = (processingMetadata as Record<string, unknown>)[LECTURE_FAILURE_METADATA_KEY];

  if (!failure || typeof failure !== "object" || Array.isArray(failure)) {
    return null;
  }

  const code = (failure as Record<string, unknown>).code;

  return typeof code === "string" && code.length > 0 ? code : null;
}

/** Whether retrying this failure could plausibly produce a different result. */
export function canRetryLectureFailureCode(code: string | null | undefined) {
  return !(typeof code === "string" && UNRETRYABLE_LECTURE_FAILURE_CODES.has(code));
}

/**
 * Convenience for the two render sites, which both hold a lecture row.
 *
 * It takes the row rather than the metadata on purpose: passing `lecture` to a function that
 * wanted `lecture.processing_metadata` reads perfectly and silently returns true for every
 * failure, because a row has no `failure` key and an unreadable code means "still retryable".
 * Requiring `processing_metadata` on the argument turns that slip into a type error.
 */
export function canRetryLectureFailure(lecture: { processing_metadata: unknown }) {
  return canRetryLectureFailureCode(readLectureFailureCode(lecture.processing_metadata));
}
