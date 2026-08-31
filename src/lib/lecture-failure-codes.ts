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
// Deliberately dependency-free so client components can import it.

export const LECTURE_FAILURE_METADATA_KEY = "failure";

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
