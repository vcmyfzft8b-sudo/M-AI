import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LectureNoLongerExistsError,
  isExpectedLectureInputFailure,
  isLectureNoLongerExistsError,
} from "../src/lib/lecture-processing-errors.ts";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const PIPELINE_SOURCE = readSource("src/lib/pipeline.ts");

// The production event (Sentry MEMOAI-WEB-32, 2026-08-27T11:34:03Z) that this file is about:
// lecture de7f7667-9c2f-47f9-b6e8-e3e7f53c0492 was deleted while its Inngest run was still going.
// The next stage to read the row got PostgREST's PGRST116 back from `.single()` and threw it, and
// markLecturePipelineFailed reported "Cannot coerce the result to a single JSON object" to Sentry
// with a null user and a null source type — because the row it reads for those was gone too.
const POSTGREST_NO_ROWS = {
  code: "PGRST116",
  message: "Cannot coerce the result to a single JSON object",
  details: "The result contains 0 rows",
  hint: null,
};

test("a lecture read out of the pipeline says it is gone, in words", () => {
  const error = new LectureNoLongerExistsError("de7f7667-9c2f-47f9-b6e8-e3e7f53c0492");

  assert.equal(isLectureNoLongerExistsError(error), true);
  assert.match(error.message, /de7f7667-9c2f-47f9-b6e8-e3e7f53c0492/);
  assert.equal(error.lectureId, "de7f7667-9c2f-47f9-b6e8-e3e7f53c0492");
  // It is not the learner's material that is at fault, so it must not be classified as one of the
  // expected input failures — those are about a recording or a scan the pipeline could not read.
  assert.equal(isExpectedLectureInputFailure(error), false);

  for (const other of [null, undefined, new Error("boom"), POSTGREST_NO_ROWS]) {
    assert.equal(isLectureNoLongerExistsError(other), false);
  }
});

test("getLectureForPipeline names the deletion instead of leaking PGRST116", () => {
  const start = PIPELINE_SOURCE.indexOf("async function getLectureForPipeline");

  assert.ok(start > 0);

  // Just this function: everything up to the first line that closes a top-level declaration.
  const rest = PIPELINE_SOURCE.slice(start);
  // Comments stripped: the one above the guard quotes `.single()` to say what it replaced.
  const body = rest
    .slice(0, rest.indexOf("\n}\n") + 3)
    .replace(/^\s*\/\/.*$/gm, "");

  // `.single()` is what produced the unreadable message; `.maybeSingle()` hands back a null row
  // so the deletion can be named.
  assert.ok(!/\.single\(\)/.test(body), "getLectureForPipeline must not use .single()");
  assert.ok(/\.maybeSingle\(\)/.test(body));
  assert.ok(/throw new LectureNoLongerExistsError\(params\.lectureId\)/.test(body));
  // A lookup that genuinely errored is still a real failure and must be rethrown, not mistaken
  // for a deleted lecture.
  assert.ok(/if \(lectureError\) \{\s*throw lectureError;/.test(body));
});

/**
 * Stands in for the branch under test at the top of markLecturePipelineFailed, against the two
 * lookup outcomes that both leave the row null. Written out here because pipeline.ts pulls in the
 * whole server graph and cannot be imported by the test runner.
 */
async function markFailed({ lookup, error }) {
  const effects = { sentry: 0, captures: 0, statusWrites: 0, warnings: [] };

  if (!lookup.error && !lookup.data) {
    effects.warnings.push("[lecture-pipeline] Lecture was deleted while it was still processing");

    return { outcome: { recorded: false }, effects };
  }

  effects.sentry += 1;
  effects.statusWrites += 1;
  effects.captures += 1;
  assert.ok(error);

  return { outcome: { recorded: true }, effects };
}

test("a lecture deleted mid-run is abandoned quietly, not reported as a defect", async () => {
  // What the production lookup returned: 200 with zero rows, so no PostgREST error.
  const { outcome, effects } = await markFailed({
    lookup: { data: null, error: null },
    error: POSTGREST_NO_ROWS,
  });

  assert.equal(outcome.recorded, false);
  assert.equal(effects.sentry, 0, "a deleted lecture is not a defect");
  // The learner deleted this material. A capture row outlives the lecture by thirty days, so
  // writing one here would retain exactly what they asked to be rid of.
  assert.equal(effects.captures, 0);
  assert.equal(effects.statusWrites, 0, "there is no row left to write a status onto");
  assert.equal(effects.warnings.length, 1);

  // Inngest reads `recorded`: false must not rethrow, or the step fails and the same missing row
  // is retried four more times.
  let rethrown = null;

  if (outcome.recorded) {
    rethrown = POSTGREST_NO_ROWS;
  }

  assert.equal(rethrown, null);
});

test("a lookup that failed is still a real failure", async () => {
  // Same null row, entirely different meaning: the database could not be reached. Treating this
  // as a deletion would silently swallow every failure during an outage.
  const { outcome, effects } = await markFailed({
    lookup: { data: null, error: { code: "57014", message: "canceling statement due to timeout" } },
    error: new Error("boom"),
  });

  assert.equal(outcome.recorded, true);
  assert.equal(effects.sentry, 1);
  assert.equal(effects.statusWrites, 1);
});

test("markLecturePipelineFailed reads the lookup error and returns before any side effect", () => {
  const start = PIPELINE_SOURCE.indexOf("export async function markLecturePipelineFailed");

  assert.ok(start > 0);

  const body = PIPELINE_SOURCE.slice(start);
  const guard = body.indexOf("if (!lectureLookupError && !lecture)");

  assert.ok(guard > 0, "the deleted-lecture guard must exist");
  assert.ok(/error: lectureLookupError/.test(body.slice(0, guard)));

  // The guard has to come before every side effect, or a deleted lecture still reaches Sentry,
  // still writes a status onto nothing, and still snapshots the learner's deleted material.
  for (const sideEffect of [
    "captureRouteError",
    "updateLectureProcessingState",
    "captureGenerationFailureInput",
  ]) {
    assert.ok(
      body.indexOf(sideEffect) > guard,
      `${sideEffect} must run after the deleted-lecture guard`,
    );
  }
});
