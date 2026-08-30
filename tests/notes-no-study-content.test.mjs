import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { StepError, serializeError } from "inngest";

import {
  canRetryLectureFailureCode,
  readLectureFailureCode,
} from "../src/lib/lecture-failure-codes.ts";
import {
  ExpectedLectureInputError,
  isExpectedLectureInputFailure,
  toLectureFailureCode,
} from "../src/lib/lecture-processing-errors.ts";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

// note-generation.ts imports "server-only", which throws outside a React Server Component, so the
// throw site is asserted on as source — the same way transcription-input-failure.test.mjs does.
const NOTE_GENERATION_SOURCE = readSource("src/lib/note-generation.ts");
const FUNCTIONS_SOURCE = readSource("src/inngest/functions.ts");

// The production event: MEMOAI-WEB-36. An audio lecture reached the notes stage with a transcript
// the extraction found nothing testable in, and the refusal was thrown as a bare Error. It was
// logged as an uncaught error on POST /api/inngest five times over five minutes for one lecture —
// the first attempt and the four Inngest retries — and reported to Sentry with
// `operation: markLecturePipelineFailed`.
function noStudyContentError() {
  return new ExpectedLectureInputError(
    "V tem gradivu nismo našli snovi, iz katere bi lahko naredili zapiske. Naloži gradivo z več razlage in poskusi znova.",
    "source_no_study_content",
  );
}

function acrossStepBoundary(error) {
  return new StepError("generate-lecture-notes", serializeError(error));
}

test("the extraction refusal is thrown as an input failure, not a bare Error", () => {
  // The bug: `throw new Error("Knowledge extraction found no study-worthy content in the source.")`
  // is invisible to every classifier the failure path runs.
  assert.doesNotMatch(
    NOTE_GENERATION_SOURCE,
    /throw new Error\("Knowledge extraction found no study-worthy content/,
    "the zero-item branch must not throw an unclassifiable bare Error",
  );
  assert.match(
    NOTE_GENERATION_SOURCE,
    /throw new ExpectedLectureInputError\(\s*\n\s*"[^"]+",\s*\n\s*"source_no_study_content",/,
    "the zero-item branch throws an ExpectedLectureInputError carrying its code",
  );
});

test("a source with nothing study-worthy in it is the learner's material, not a defect", () => {
  assert.equal(isExpectedLectureInputFailure(noStudyContentError()), true);
  // What markLecturePipelineFailed asks before it decides between a warn line and a Sentry report.
  assert.equal(
    isExpectedLectureInputFailure(
      new Error("Knowledge extraction found no study-worthy content in the source."),
    ),
    false,
    "the bare Error the pipeline used to throw is the one that reached Sentry",
  );
});

test("the failed note stops offering a retry that cannot work", () => {
  // Both extraction passes read the source and neither found a claim, and the per-window
  // extractions are checkpointed — so a retry replays the same empty result and fails identically.
  const metadata = {
    processing: { stage: "failed" },
    failure: { code: toLectureFailureCode(noStudyContentError()) },
  };

  assert.equal(readLectureFailureCode(metadata), "source_no_study_content");
  assert.equal(canRetryLectureFailureCode(readLectureFailureCode(metadata)), false);

  // The old bare Error carried no code at all, which keeps the button on offer by default.
  assert.equal(
    toLectureFailureCode(new Error("Knowledge extraction found no study-worthy content in the source.")),
    null,
  );
  assert.equal(canRetryLectureFailureCode(null), true);
});

test("the notes step classifies input failures on the throwing side of the boundary", () => {
  assert.match(
    FUNCTIONS_SOURCE,
    /isLectureGenerationBudgetExceededError\(error\) \|\| isExpectedLectureInputFailure\(error\)/,
    "runNotesStageWithGuard records input failures instead of failing its step",
  );
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

// What runNotesStageWithGuard does now: the error is still the object that was thrown, so the
// refusal is recorded here and the step reports itself as handled instead of failing.
function runNotesStage(run, markFailed) {
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

test("classifying after the step boundary is what put a thin source in Sentry", async () => {
  const recorder = { captured: [], marked: [] };
  const markFailed = markLectureFailed(recorder);
  let rejected = null;

  // The pre-fix path: nothing classified the refusal inside the step, so it failed the step.
  try {
    await runStep(() => Promise.reject(noStudyContentError()));
  } catch (error) {
    await markFailed(error);
    rejected = error;
  }

  assert.equal(recorder.captured.length, 1, "the production defect: an expected failure reported");
  assert.equal(
    toLectureFailureCode(recorder.marked[0]),
    null,
    "and the code that would have hidden the retry button did not survive the boundary",
  );
  // The rethrow that follows is what failed the run, and what the platform log recorded as an
  // uncaught error on POST /api/inngest.
  assert.ok(rejected);
});

test("classifying inside the step keeps a thin source out of Sentry and out of a retry", async () => {
  const recorder = { captured: [], marked: [] };
  const markFailed = markLectureFailed(recorder);

  const result = await runStep(runNotesStage(() => Promise.reject(noStudyContentError()), markFailed));

  assert.deepEqual(result, { completed: false }, "the step completes, so Inngest does not retry it");
  assert.equal(recorder.captured.length, 0, "nothing reported to Sentry");
  assert.equal(recorder.marked.length, 1, "the lecture is still marked failed, honestly");
  assert.equal(
    toLectureFailureCode(recorder.marked[0]),
    "source_no_study_content",
    "with the code the UI reads to drop the retry button",
  );
});
