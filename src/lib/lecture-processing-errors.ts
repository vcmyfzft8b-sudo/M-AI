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

/**
 * A run that was abandoned rather than refused: the invocation was killed before it could record
 * anything, and a later reader found the row still in progress long past the point where that
 * could be true.
 *
 * Deliberately not an `ExpectedLectureInputError` — nothing about the learner's input caused it,
 * so it must keep reaching Sentry and keep its retry button. It carries a code only so the note
 * screen can name the failure in the reader's language.
 */
export class LectureProcessingStalledError extends Error {
  readonly code = "processing_stalled";

  constructor(message: string) {
    super(message);
    this.name = "LectureProcessingStalledError";
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

  if (error instanceof LectureProcessingStalledError) {
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

/**
 * The lecture row is gone. A learner can delete a lecture while its pipeline is still running,
 * and every stage that reads the row throws the moment they do.
 *
 * The stages used to reach that through `.single()`, which raises PostgREST's "Cannot coerce the
 * result to a single JSON object" — a message that names neither the lecture nor the deletion,
 * and that was written verbatim into the lecture's `error_message` and reported to Sentry as a
 * defect.
 */
export class LectureNoLongerExistsError extends Error {
  readonly lectureId: string;

  constructor(lectureId: string) {
    super(`Lecture ${lectureId} no longer exists.`);
    this.name = "LectureNoLongerExistsError";
    this.lectureId = lectureId;
  }
}

/**
 * Only ask this while the error is still the object that was thrown — across an Inngest step
 * boundary the class is flattened away, exactly as for `isExpectedLectureInputFailure`. On the far
 * side, ask the database instead: no row means the lecture is gone, whatever the error says.
 */
export function isLectureNoLongerExistsError(error: unknown) {
  return (
    error instanceof LectureNoLongerExistsError ||
    (error instanceof Error && error.name === "LectureNoLongerExistsError")
  );
}
