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
