import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isMissingLectureReferenceError } from "../src/lib/postgres-errors.ts";

// Copied verbatim from the production log line that returned the 500, including PostgREST's own
// wording. It is a plain object, not an Error, which is why `instanceof` cannot classify it.
const DELETED_LECTURE_ERROR = {
  code: "23503",
  details:
    'Key (lecture_id)=(07c0583e-5322-41ad-ad62-f5194b8b7aa5) is not present in table "lectures".',
  hint: null,
  message:
    'insert or update on table "lecture_tts_chunks" violates foreign key constraint "lecture_tts_chunks_lecture_id_fkey"',
};

test("recognises the write that lost a race with the note being deleted", () => {
  assert.equal(isMissingLectureReferenceError(DELETED_LECTURE_ERROR), true);
});

test("recognises the same failure on any table that cascades from lectures", () => {
  assert.equal(
    isMissingLectureReferenceError({
      code: "23503",
      details: 'Key (lecture_id)=(07c0583e-5322-41ad-ad62-f5194b8b7aa5) is not present in table "lectures".',
      message:
        'insert or update on table "lecture_artifacts" violates foreign key constraint "lecture_artifacts_lecture_id_fkey"',
    }),
    true,
  );
});

test("leaves every other database failure to the 500 it deserves", () => {
  // A foreign key, but not the lecture's: this one means the write itself is wrong.
  assert.equal(
    isMissingLectureReferenceError({
      code: "23503",
      details: 'Key (user_id)=(00000000-0000-0000-0000-000000000000) is not present in table "users".',
      message:
        'insert or update on table "lecture_tts_chunks" violates foreign key constraint "lecture_tts_chunks_user_id_fkey"',
    }),
    false,
  );

  // A duplicate row, which the upsert's onConflict is supposed to handle.
  assert.equal(
    isMissingLectureReferenceError({
      code: "23505",
      details: "Key (lecture_id, content_hash, chunk_index)=(...) already exists.",
      message: 'duplicate key value violates unique constraint "lecture_tts_chunks_cache_unique"',
    }),
    false,
  );

  assert.equal(isMissingLectureReferenceError(new Error("insert failed")), false);
  assert.equal(isMissingLectureReferenceError({ code: 23503 }), false);
  assert.equal(isMissingLectureReferenceError("23503"), false);
  assert.equal(isMissingLectureReferenceError(null), false);
  assert.equal(isMissingLectureReferenceError(undefined), false);
});

test("the chunk route answers a deleted note the way it answers a missing one", () => {
  const routeSource = readFileSync(
    fileURLToPath(
      new URL("../src/app/api/lectures/[id]/tts/chunks/route.ts", import.meta.url),
    ),
    "utf8",
  );

  // The 500 below it stays: this branch must sit ahead of it, or the deleted note keeps logging a
  // stack and reporting the server as broken.
  assert.match(
    routeSource,
    /error instanceof LectureRemovedDuringTtsError\)\s*\{\s*return NextResponse\.json\(\{ error: "Ni najdeno\." \}, \{ status: 404 \}\)/,
  );
  assert.ok(
    routeSource.indexOf("LectureRemovedDuringTtsError") <
      routeSource.indexOf('console.error("Failed to prepare note TTS chunk"'),
  );
});
