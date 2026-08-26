import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { StepError, serializeError } from "inngest";

import {
  ExpectedLectureInputError,
  isExpectedLectureInputFailure,
} from "../src/lib/lecture-processing-errors.ts";
import { NoReadableScanTextError } from "../src/lib/scan-ocr-errors.ts";
import {
  InvalidAudioFileError,
  NoClearSpeechDetectedError,
} from "../src/lib/transcription/types.ts";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const PIPELINE_SOURCE = readSource("src/lib/pipeline.ts");
const FUNCTIONS_SOURCE = readSource("src/inngest/functions.ts");

function noClearSpeechError() {
  return new NoClearSpeechDetectedError({
    provider: "soniox",
    model: "stt-async-preview",
    file: { mimeType: "audio/mp4", sizeBytes: 4_204_112 },
    attempts: [],
  });
}

// What Inngest does to a step's error: the SDK serialises it to send to the executor, and once the
// step has spent its retries the function body is handed a StepError rebuilt from that JSON.
function acrossStepBoundary(error) {
  return new StepError("transcribe-lecture", serializeError(error));
}

test("an input failure is anything the learner has to fix in the file they uploaded", () => {
  for (const error of [
    noClearSpeechError(),
    new InvalidAudioFileError(),
    new NoReadableScanTextError({
      imageCount: 1,
      images: [],
      readableImageCount: 0,
      skippedImageCount: 1,
    }),
    new ExpectedLectureInputError("Povezava ne vsebuje besedila.", "link_empty"),
  ]) {
    assert.equal(isExpectedLectureInputFailure(error), true, error.name);
  }

  for (const error of [new Error("Soniox transcription failed with status error."), null, "boom"]) {
    assert.equal(isExpectedLectureInputFailure(error), false, String(error));
  }
});

// The production event: a lecture whose audio had no discernible speech reached Sentry as
// MEMOAI-WEB-2R with `operation: markLecturePipelineFailed` and an exception type of plain "Error",
// and the run it failed showed up as an uncaught error on POST /api/inngest. This is why — by the
// time the function body catches it, the error the failure path classifies is not the error that
// was thrown.
test("the step boundary leaves nothing behind to classify an input failure by", () => {
  const thrown = noClearSpeechError();
  const caught = acrossStepBoundary(thrown);

  assert.equal(caught.message, thrown.message, "the learner-facing message is all that survives");
  assert.equal(caught instanceof NoClearSpeechDetectedError, false);
  assert.equal(caught.name, "Error", "the class name is flattened, so a name check cannot see it");
  assert.equal(caught.diagnostics, undefined, "the provider diagnostics are dropped");
  assert.equal(isExpectedLectureInputFailure(caught), false);
});

// Stands in for markLecturePipelineFailed: the two decisions it makes from the error it is handed.
function markLectureFailed(recorder) {
  return async (error) => {
    recorder.marked.push(error);

    if (!isExpectedLectureInputFailure(error)) {
      recorder.captured.push(error);
    }

    return { recorded: true };
  };
}

// Stands in for step.run: a failed step is retried, and the error only reaches the function body
// once the retries are spent — flattened by the boundary on its way there.
async function runStep(run) {
  try {
    return await run();
  } catch (error) {
    throw acrossStepBoundary(error);
  }
}

// What runLectureStage does: the error is still the object that was thrown, so the failure is
// recorded here and the step reports itself as handled instead of failing.
function runStage(run, markFailed) {
  return async () => {
    try {
      await run();

      return { completed: true };
    } catch (error) {
      if (!isExpectedLectureInputFailure(error)) {
        throw error;
      }

      await markFailed(error);

      return { completed: false };
    }
  };
}

test("classifying after the step boundary is what put a silent recording in Sentry", async () => {
  const recorder = { captured: [], marked: [] };
  const markFailed = markLectureFailed(recorder);
  let rejected = null;

  try {
    await runStep(() => Promise.reject(noClearSpeechError()));
  } catch (error) {
    await markFailed(error);
    rejected = error;
  }

  assert.equal(recorder.captured.length, 1, "the production defect: an expected failure reported");
  assert.equal(recorder.marked[0].diagnostics, undefined, "with no diagnostics to explain it");
  // The rethrow that follows is what failed the run, and what the platform log recorded as an
  // uncaught error on POST /api/inngest.
  assert.ok(rejected);
});

test("classifying inside the step keeps a silent recording out of Sentry and out of a retry", async () => {
  const recorder = { captured: [], marked: [] };
  const markFailed = markLectureFailed(recorder);
  let rejected = null;
  let outcome = null;

  try {
    outcome = await runStep(runStage(() => Promise.reject(noClearSpeechError()), markFailed));
  } catch (error) {
    rejected = error;
  }

  assert.equal(rejected, null, "a recording with no speech in it must not fail the run");
  assert.deepEqual(outcome, { completed: false });
  assert.equal(recorder.marked.length, 1, "the learner is still told what went wrong");
  assert.deepEqual(recorder.captured, [], "and it is still not reported as a defect");
  assert.equal(recorder.marked[0].diagnostics.provider, "soniox", "the diagnostics survive too");

  // A defect still fails its step, so Inngest retries it and the failure path reports it.
  const broken = new Error('insert or update on table "transcript_segments" violates ...');

  await assert.rejects(() => runStep(runStage(() => Promise.reject(broken), markFailed)));
});

test("the failure path and the step ask the same question about an error", () => {
  const guard = PIPELINE_SOURCE.indexOf(
    "const expectedInputFailure = isExpectedLectureInputFailure(params.error)",
  );
  const capture = PIPELINE_SOURCE.indexOf("captureRouteError(params.error");

  assert.ok(guard > 0, "the Sentry capture no longer skips expected input failures");
  assert.ok(guard < capture, "the guard must come before the capture it skips");
  assert.ok(
    PIPELINE_SOURCE.includes("if (!expectedInputFailure) {"),
    "the capture must be conditioned on the expected-input predicate",
  );

  const stage = PIPELINE_SOURCE.indexOf("export async function runLectureStage");
  const stageBody = PIPELINE_SOURCE.slice(stage, PIPELINE_SOURCE.indexOf("\nexport ", stage + 1));

  assert.ok(stage > 0, "runLectureStage is gone; the classification is back across the boundary");
  assert.ok(stageBody.includes("if (!isExpectedLectureInputFailure(error)) {\n      throw error;"));
  assert.ok(
    stageBody.indexOf("markLecturePipelineFailed") < stageBody.indexOf("return { completed: false }"),
    "the failure has to be recorded before the step reports it as handled",
  );
});

test("the transcription step runs through runLectureStage and stops when it did not complete", () => {
  const step = FUNCTIONS_SOURCE.indexOf('step.run("transcribe-lecture"');
  const notes = FUNCTIONS_SOURCE.indexOf('step.run("generate-lecture-notes"');
  const stage = FUNCTIONS_SOURCE.indexOf("runLectureStage(", step);
  const guard = FUNCTIONS_SOURCE.indexOf("if (transcription?.completed === false) {", step);

  assert.ok(step > 0 && notes > step);
  assert.ok(stage > step && stage < notes, "the transcription no longer runs through runLectureStage");
  assert.ok(
    guard > stage && guard < notes,
    "notes must not be generated from a transcript the failed stage never wrote",
  );
});

// A run already in flight when this ships replays the transcribe step from memoized state, and
// before this change that step returned nothing. Inngest stores a step's undefined output as null
// (`undefinedToNull`), so the guard is handed null on exactly those runs -- reading `.completed`
// off it would throw a TypeError out of a lecture whose transcript is perfectly good, and the
// catch below would mark it failed and report it to Sentry as a defect.
test("an in-flight run replaying a step that returned nothing still generates its notes", () => {
  const guard = (transcription) => transcription?.completed === false;

  assert.equal(guard(null), false, "the memoized output of the old void step");
  assert.equal(guard(undefined), false, "in case the executor sends no data at all");
  assert.equal(guard({ completed: true }), false, "a transcript was written; carry on to notes");
  assert.equal(guard({ completed: false }), true, "no speech; stop before the notes step");

  const source = FUNCTIONS_SOURCE.slice(
    FUNCTIONS_SOURCE.indexOf('step.run("transcribe-lecture"'),
    FUNCTIONS_SOURCE.indexOf('step.run("generate-lecture-notes"'),
  );

  assert.equal(
    source.includes("!transcription.completed"),
    false,
    "a bare truthiness check would throw on the memoized null of an in-flight run",
  );
});
