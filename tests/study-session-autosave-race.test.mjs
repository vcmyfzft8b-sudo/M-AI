import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isMissingLectureReferenceError } from "../src/lib/postgres-errors.ts";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const ROUTE_SOURCE = readSource("src/app/api/lectures/[id]/study-session/route.ts");

/*
 * Two production 500s on PATCH /api/lectures/<id>/study-session — 2026-09-02T16:55:06Z on lecture
 * ec922875-ea26-4df5-a5ff-3951afbf8215 and 2026-09-07T19:17:15Z on 44212c65-ad8a-4782-be23-
 * f381935a65b4 — and neither left a single character of explanation anywhere. The route matched
 * `if (error) return 500` and dropped the PostgREST object on the floor, so there was no SQLSTATE
 * in Vercel and no Sentry event to read. This file exists so that stops being possible.
 *
 * The shape below is the one the delete race produces, built from the same 23503 the TTS chunk
 * route was fixed for; `lecture_study_sessions.lecture_id` is `on delete cascade` too.
 */
const DELETED_LECTURE_UPSERT_ERROR = {
  code: "23503",
  details:
    'Key (lecture_id)=(44212c65-ad8a-4782-be23-f381935a65b4) is not present in table "lectures".',
  hint: null,
  message:
    'insert or update on table "lecture_study_sessions" violates foreign key constraint ' +
    '"lecture_study_sessions_lecture_id_fkey"',
};

test("the autosave that lost a race with the note being deleted is recognised", () => {
  assert.equal(isMissingLectureReferenceError(DELETED_LECTURE_UPSERT_ERROR), true);
});

test("a deleted note answers 404, ahead of the 500 that used to swallow it", () => {
  // The learner's own delete does this: `deleteNote` navigates away as soon as the DELETE
  // resolves, the workspace unmounts, and its cleanup flushes one last PATCH.
  assert.match(
    ROUTE_SOURCE,
    /if \(isMissingLectureReferenceError\(error\)\) \{\s*return NextResponse\.json\(\{ error: await tr\("api\.notFound"\) \}, \{ status: 404 \}\);/,
  );

  // Order matters: behind the 500 this branch would never be reached.
  assert.ok(
    ROUTE_SOURCE.indexOf("isMissingLectureReferenceError(error)") <
      ROUTE_SOURCE.indexOf("status: 500"),
    "the deleted-note branch must sit ahead of the 500",
  );
});

test("every other upsert failure is reported before its 500", () => {
  assert.ok(
    ROUTE_SOURCE.includes("captureRouteError(error, {"),
    "the route must report the upsert failure it cannot explain",
  );
  assert.ok(
    ROUTE_SOURCE.indexOf("captureRouteError(error, {") < ROUTE_SOURCE.indexOf("status: 500"),
    "the report must happen before the response returns",
  );
  assert.match(ROUTE_SOURCE, /operation: "upsertStudySession"/);
  assert.match(ROUTE_SOURCE, /lectureId: id/);
});

/*
 * `practiceTestState.textAnswers` is the only free-text field on this route: whatever the learner
 * typed into a practice test. A diagnostic that shipped their answers to Sentry would be a worse
 * bug than the one it was added to explain, so the report may carry how many there were and
 * nothing else.
 */
test("the diagnostic counts the learner's answers without quoting them", () => {
  assert.match(ROUTE_SOURCE, /textAnswerCount: parsed\.data\.practiceTestState/);

  const report = ROUTE_SOURCE.slice(
    ROUTE_SOURCE.indexOf("captureRouteError(error, {"),
    ROUTE_SOURCE.indexOf("status: 500"),
  );

  assert.ok(
    !/textAnswers[,:\s]*\}?\s*$/m.test(report.replace(/textAnswerCount[^\n]*\n/g, "")),
    "the answers themselves must not be attached to the report",
  );
  assert.ok(
    !report.includes("parsed.data.practiceTestState.textAnswers,") &&
      !report.includes("textAnswers: parsed.data.practiceTestState.textAnswers"),
    "the answers themselves must not be attached to the report",
  );
});
