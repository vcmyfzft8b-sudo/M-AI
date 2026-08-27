// Imported by their real filenames so the Node test runner can load this module directly.
import { NoReadableScanTextError } from "./scan-ocr-errors.ts";
import { InvalidAudioFileError, NoClearSpeechDetectedError } from "./transcription/types.ts";

export class ExpectedLectureInputError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ExpectedLectureInputError";
    this.code = code;
  }
}

export function isExpectedLectureInputError(error: unknown) {
  return (
    error instanceof ExpectedLectureInputError ||
    (error instanceof Error && error.name === "ExpectedLectureInputError")
  );
}

/**
 * The failures that are the recording, the photo or the file itself: no speech in the audio, no
 * readable text on the page, a container we cannot decode. The pipeline has already told the
 * learner what to do about it, so it is not a defect and must never reach Sentry.
 *
 * Only ask this while the error is still the object that was thrown. Inngest serialises a failed
 * step's error down to `{ name: "Error", message, stack }` and rebuilds it as a `StepError` before
 * the function body sees it, so on the far side of a step boundary the class is gone, `name` reads
 * "Error", and the diagnostics the constructor carried are dropped — every check below is false.
 */
export function isExpectedLectureInputFailure(error: unknown) {
  return (
    error instanceof InvalidAudioFileError ||
    error instanceof NoClearSpeechDetectedError ||
    error instanceof NoReadableScanTextError ||
    isExpectedLectureInputError(error)
  );
}

/**
 * What PostgREST answers a `.single()` whose row is not there: code `PGRST116`, message "Cannot
 * coerce the result to a single JSON object". Every pipeline stage opens by loading its lecture
 * that way, so this is the shape a lecture deleted mid-run throws.
 *
 * Recognised by message as well as by code on purpose — unlike the class checks above this one
 * has to survive an Inngest step boundary, where the error arrives rebuilt as a plain `Error`
 * with nothing but its message left.
 */
export function isMissingLectureRowError(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    if ((error as { code?: unknown }).code === "PGRST116") {
      return true;
    }
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? (error as { message?: unknown }).message
        : null;

  return (
    typeof message === "string" &&
    /cannot coerce the result to a single json object/i.test(message)
  );
}

/**
 * True when a pipeline failure is nothing but the learner deleting the lecture while its run was
 * still going: the stage failed because its `lectures` row was gone, and the row is still gone.
 *
 * `DELETE /api/lectures/[id]` drops the row and leaves the Inngest run to finish on its own, so
 * this is ordinary use, not a defect — there is no row left to record a failure on and nobody
 * waiting for the answer.
 *
 * Both halves are required. A lookup that *errored* proves nothing about whether the row exists,
 * so it is not treated as deletion; and a row that is missing while the stage failed for some
 * other reason is a genuinely odd state that should still be reported.
 */
export function isDeletedLectureFailure(params: {
  error: unknown;
  /** The row the failure handler's own lookup returned, null when it found none. */
  lectureRow: unknown;
  /** Whether that lookup itself failed, in which case its empty result means nothing. */
  lectureLookupFailed: boolean;
}) {
  return (
    !params.lectureLookupFailed &&
    (params.lectureRow === null || params.lectureRow === undefined) &&
    isMissingLectureRowError(params.error)
  );
}

/**
 * The code to record on a failed lecture, so the UI can tell a failure retry might clear from one
 * it cannot. Null for anything unrecognised, which keeps retry on offer by default.
 *
 * Carries the same caveat as `isExpectedLectureInputFailure`: ask while the error is still the
 * object that was thrown. Past an Inngest step boundary the class and the `code` are gone, and
 * this returns null.
 */
export function toLectureFailureCode(error: unknown) {
  if (error instanceof ExpectedLectureInputError && error.code.length > 0) {
    return error.code;
  }

  if (error instanceof NoReadableScanTextError) {
    return "scan_not_enough_text";
  }

  if (error instanceof NoClearSpeechDetectedError) {
    return "audio_no_clear_speech";
  }

  if (error instanceof InvalidAudioFileError) {
    return "audio_not_decodable";
  }

  return null;
}
