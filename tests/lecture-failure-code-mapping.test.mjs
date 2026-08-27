import assert from "node:assert/strict";
import test from "node:test";

import {
  canRetryLectureFailureCode,
  readLectureFailureCode,
} from "../src/lib/lecture-failure-codes.ts";
import {
  ExpectedLectureInputError,
  toLectureFailureCode,
} from "../src/lib/lecture-processing-errors.ts";
import { NoReadableScanTextError } from "../src/lib/scan-ocr-errors.ts";
import {
  InvalidAudioFileError,
  NoClearSpeechDetectedError,
} from "../src/lib/transcription/types.ts";

test("an expected input error hands over its own code", () => {
  assert.equal(
    toLectureFailureCode(new ExpectedLectureInputError("...", "link_requires_login")),
    "link_requires_login",
  );
});

test("the audio and scan failures get codes of their own", () => {
  assert.equal(toLectureFailureCode(new NoReadableScanTextError({})), "scan_not_enough_text");
  assert.equal(toLectureFailureCode(new NoClearSpeechDetectedError({})), "audio_no_clear_speech");
  assert.equal(toLectureFailureCode(new InvalidAudioFileError()), "audio_not_decodable");
});

test("anything else is uncoded, which keeps retry on offer", () => {
  assert.equal(toLectureFailureCode(new Error("Gemini exploded")), null);
  assert.equal(toLectureFailureCode("a string"), null);
  assert.equal(toLectureFailureCode(null), null);
  assert.equal(canRetryLectureFailureCode(toLectureFailureCode(new Error("boom"))), true);
});

test("a code erased crossing an Inngest step boundary degrades to retryable", () => {
  // Inngest rebuilds a failed step's error as a plain Error: the class is gone and `code` with
  // it. The pipeline must not then claim a verdict it no longer has.
  const rebuilt = new Error("Za ogled te povezave je potrebna prijava...");
  rebuilt.name = "Error";

  assert.equal(toLectureFailureCode(rebuilt), null);
  assert.equal(canRetryLectureFailureCode(toLectureFailureCode(rebuilt)), true);
});

test("the whole chain, as the pipeline and the UI run it", () => {
  // throw -> code -> processing metadata -> read back -> render decision
  for (const [error, expectedCode, expectedRetry] of [
    [new ExpectedLectureInputError("...", "link_requires_login"), "link_requires_login", false],
    [new ExpectedLectureInputError("...", "unsupported_link_content_type"), "unsupported_link_content_type", false],
    [new ExpectedLectureInputError("...", "link_timeout"), "link_timeout", true],
    [new Error("provider blew up"), null, true],
  ]) {
    const metadata = { processing: { stage: "failed" }, failure: { code: toLectureFailureCode(error) } };

    assert.equal(readLectureFailureCode(metadata), expectedCode);
    assert.equal(canRetryLectureFailureCode(readLectureFailureCode(metadata)), expectedRetry);
  }
});
