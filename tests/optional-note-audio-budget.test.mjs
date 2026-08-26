import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runWithinInvocationBudget } from "../src/lib/invocation-budget.ts";
import {
  INITIAL_NOTE_AUDIO_STAGE,
  getLectureProcessingStage,
  isPreparingInitialNoteAudio,
} from "../src/lib/note-audio-stage.ts";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const PIPELINE_SOURCE = readSource("src/lib/pipeline.ts");
const FUNCTIONS_SOURCE = readSource("src/inngest/functions.ts");
const NOTE_TTS_SOURCE = readSource("src/lib/note-tts.ts");

test("only the optional initial-audio stage counts as finished notes", () => {
  assert.equal(isPreparingInitialNoteAudio({ processing: { stage: "preparing_audio" } }), true);

  // Every stage before it still owes the learner the thing they are waiting for, so a failure
  // there is a real failure.
  for (const stage of ["transcribing", "generating_notes", "checking_document_images"]) {
    assert.equal(isPreparingInitialNoteAudio({ processing: { stage } }), false, stage);
  }

  for (const metadata of [null, undefined, {}, [], "preparing_audio", { processing: null }]) {
    assert.equal(isPreparingInitialNoteAudio(metadata), false);
    assert.equal(getLectureProcessingStage(metadata), null);
  }
});

// The production failure: a 136 KB text import generated its notes in about 160 seconds, then spent
// the rest of the 280-second step budget preparing the optional first audio chunk. The budget
// rejected at 10:44:44 UTC with the lecture sitting at `preparing_audio` — notes written, artifact
// marked complete — and markLecturePipelineFailed marked the whole lecture failed. The learner was
// told "Obdelava je trajala predolgo" while their finished notes sat in lecture_artifacts, and
// reconcileLectureWithArtifact will not rescue a failed row.
test("a budget reached during the optional audio leaves the finished lecture ready", async () => {
  const lecture = { processing_metadata: { processing: { stage: INITIAL_NOTE_AUDIO_STAGE } } };
  let writtenStage = null;
  let rethrown = null;

  // Stands in for markLecturePipelineFailed: the branch under test, against the row state the
  // production event recorded.
  async function markFailed(error) {
    if (isPreparingInitialNoteAudio(lecture.processing_metadata)) {
      writtenStage = "ready";

      return { recorded: false };
    }

    writtenStage = "failed";
    assert.ok(error);

    return { recorded: true };
  }

  try {
    // The pipeline is still inside prepareInitialNoteTtsChunksSafely, which never rejects on its
    // own — the budget rejects the race around it instead, so no catch inside the pipeline sees it.
    await runWithinInvocationBudget({
      run: () => new Promise(() => {}),
      budgetMs: 20,
      deadlineMessage: "Obdelava je trajala predolgo in se je ustavila. Poskusi znova.",
    });
  } catch (error) {
    const outcome = await markFailed(error);

    if (outcome.recorded) {
      rethrown = error;
    }
  }

  assert.equal(writtenStage, "ready");
  // Rethrowing would make Inngest retry the step and regenerate the finished notes four more times.
  assert.equal(rethrown, null);
});

test("the stage is written and read through the same constant", () => {
  // markInitialNoteAudioPreparing is the only writer of this stage. A literal on either side would
  // silently stop the failure path from recognising a finished lecture.
  assert.match(NOTE_TTS_SOURCE, /stage: INITIAL_NOTE_AUDIO_STAGE/);
  assert.equal(NOTE_TTS_SOURCE.includes('stage: "preparing_audio"'), false);
  assert.equal(INITIAL_NOTE_AUDIO_STAGE, "preparing_audio");
});

test("the failure path checks for finished notes before recording a failure", () => {
  const marker = PIPELINE_SOURCE.indexOf("isPreparingInitialNoteAudio(metadata)");
  const failedWrite = PIPELINE_SOURCE.indexOf('stage: "failed"');

  assert.ok(marker > 0, "markLecturePipelineFailed no longer checks for finished notes");
  assert.ok(
    marker < failedWrite,
    "the check must come before the failed write, and before the Sentry capture it skips",
  );
});

test("the Inngest functions only fail a step whose failure was recorded", () => {
  const catches = FUNCTIONS_SOURCE.split("markLecturePipelineFailed(").slice(1);

  assert.equal(
    catches.length,
    3,
    "expected the guard's in-step path plus both lecture-note catch paths to record failures",
  );

  // The first occurrence is the generation guard's in-step classification: the refusal is
  // recorded on the throwing side and the step completes with { completed: false } — it must
  // not fail the step, or Inngest retries a refusal four more times and the function body
  // reports an unclassifiable StepError.
  const guardBody = catches[0];
  const guardReturn = guardBody.indexOf("return { completed: false }");

  assert.ok(guardReturn > 0, "the guard refusal no longer completes its step");
  assert.ok(
    guardReturn < guardBody.indexOf("throw error;"),
    "only unclassified errors may fail the guard's step",
  );

  for (const body of catches.slice(1)) {
    const rethrow = body.indexOf("throw error;");

    assert.ok(rethrow > 0, "the failure is no longer rethrown at all");
    assert.ok(
      body.slice(0, rethrow).includes("if (outcome.recorded)"),
      "an unrecorded failure means the lecture is ready, so the step must not fail",
    );
  }
});
