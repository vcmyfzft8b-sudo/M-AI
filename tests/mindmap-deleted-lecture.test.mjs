import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isMissingLectureReferenceError } from "../src/lib/postgres-errors.ts";
import { isLectureNoLongerExistsError } from "../src/lib/lecture-processing-errors.ts";

/*
 * A note deleted while its map was being drawn used to be reported as a defect. The map is written
 * by a background Inngest job that can run for minutes after the reader opened the tab, and every
 * row keyed by `lecture_id` cascades from `public.lectures` — so the delete lands first and the
 * job's own write is refused by the foreign key.
 *
 * `mindmap.ts` cannot be imported here: it is a "server-only" module behind the `@/` alias, which
 * the Node test runner cannot resolve. So the classifier is tested on the real error object and
 * the wiring that consumes it is asserted against the source, the way the TTS chunk route is.
 */

// Copied verbatim from the production failure (Sentry MEMOAI-WEB-3G), lecture id replaced.
const DELETED_LECTURE_MINDMAP_ERROR = {
  code: "23503",
  details: 'Key (lecture_id)=(2e10f01a-e2a4-4b55-b2e7-11b3be408e11) is not present in table "lectures".',
  hint: null,
  message:
    'insert or update on table "lecture_mindmap_assets" violates foreign key constraint "lecture_mindmap_assets_lecture_id_fkey"',
};

function mindmapSource() {
  return readFileSync(fileURLToPath(new URL("../src/lib/mindmap.ts", import.meta.url)), "utf8");
}

test("the map's own foreign key failure reads as a deleted note", () => {
  assert.equal(isMissingLectureReferenceError(DELETED_LECTURE_MINDMAP_ERROR), true);
});

test("a mindmap write that failed for any other reason still deserves its alert", () => {
  // The table exists and the note exists; this write is simply wrong.
  assert.equal(
    isMissingLectureReferenceError({
      code: "23502",
      details: 'Failing row contains (null, null).',
      message: 'null value in column "status" of relation "lecture_mindmap_assets" violates not-null constraint',
    }),
    false,
  );

  // The relation is missing entirely — the deploy-order case the module already tolerates on read,
  // but which on write is a real problem and must not be mistaken for a deleted note.
  assert.equal(
    isMissingLectureReferenceError({
      code: "42P01",
      message: 'relation "public.lecture_mindmap_assets" does not exist',
    }),
    false,
  );
});

test("LectureNoLongerExistsError is what the mindmap writer raises for it", () => {
  const source = mindmapSource();

  // The guard must sit ahead of the bare re-throw, or the deletion keeps arriving as a raw
  // PostgREST object that nothing downstream can classify.
  assert.match(
    source,
    /if \(isMissingLectureReferenceError\(error\)\) \{\s*throw new LectureNoLongerExistsError\(params\.lectureId\);\s*\}/,
  );
  assert.ok(
    source.indexOf("isMissingLectureReferenceError(error)") < source.lastIndexOf("throw error;"),
  );
});

test("a gone note ends the draw instead of writing a failure row it cannot write", () => {
  const source = mindmapSource();

  const guard = source.indexOf("isLectureNoLongerExistsError(error)");
  const failedWrite = source.indexOf('status: "failed",\n      errorMessage: describeMindmapError(error),');

  assert.notEqual(guard, -1, "the writer must recognise a note that is already gone");
  assert.notEqual(failedWrite, -1, "the failure write this guard protects has moved");
  // Ahead of the `failed` write, which is the second foreign key violation that actually escaped
  // to Sentry: the `ready` write lost the race, and recording that failure lost it again.
  assert.ok(guard < failedWrite);
});

test("the mindmap job does not report a deleted note as a defect", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/inngest/functions.ts", import.meta.url)),
    "utf8",
  );

  // The two status writes that sit outside generateLectureMindmap's own try block reach this
  // catch directly, so the guard is needed here as well as in the writer.
  assert.match(
    source,
    /!isExpectedLectureInputFailure\(error\) && !isLectureNoLongerExistsError\(error\)\) \{\s*captureRouteError\(error, \{\s*route: "inngest:process-lecture-mindmap"/,
  );
});

test("the classifier recognises the error the writer now raises", () => {
  assert.equal(
    isLectureNoLongerExistsError(
      Object.assign(new Error("Lecture 2e10f01a no longer exists."), {
        name: "LectureNoLongerExistsError",
      }),
    ),
    true,
  );
  assert.equal(isLectureNoLongerExistsError(new Error("insert failed")), false);
});
