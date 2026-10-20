import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * The note pipeline is server-only and cannot be imported here, so these pin the two decisions
 * that kept every new note failing on 2026-10-20 (MEMOAI-WEB-65): where a transcript's embeddings
 * are allowed to fail, and which side of the Inngest step boundary records the spend cap.
 */
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} exists`);
  const next = source.indexOf("\nexport ", start + signature.length);
  const nextLocal = source.indexOf("\nasync function ", start + signature.length);
  const ends = [next, nextLocal].filter((index) => index > 0);

  return source.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
}

test("a transcript is saved through the embedding path that cannot fail the note", () => {
  const pipeline = read("src/lib/pipeline.ts");
  const manual = read("src/lib/manual-lectures.ts");

  // Twice in the pipeline (a recording's transcript, a text source's synthetic one), once in the
  // document importer.
  assert.equal(pipeline.match(/await embedTranscriptTexts\(\{/g)?.length, 2);
  assert.equal(manual.match(/await embedTranscriptTexts\(\{/g)?.length, 1);
  assert.doesNotMatch(manual, /createEmbeddings\(/);

  // The only direct call left embeds a chat question, inside retrieval's own catch.
  assert.equal(pipeline.match(/createEmbeddings\(/g)?.length, 1);
  const retrieval = functionBody(pipeline, "async function retrieveLectureContext");
  assert.match(retrieval, /try \{\s*const \[embedding\] = await createEmbeddings\(\[params\.question\]\);/);
});

test("only a budget abort escapes the transcript embeddings", () => {
  const body = functionBody(read("src/lib/transcript-embeddings.ts"), "export async function embedTranscriptTexts");
  const handler = body.slice(body.indexOf("} catch (error) {"));

  assert.match(handler, /if \(isWorkAbortedError\(error\)\) \{\s*throw error;\s*\}/);
  assert.equal(handler.match(/throw /g)?.length, 1, "nothing else is rethrown");
  assert.match(handler, /captureBackgroundError\(error,/, "the degradation still reaches Sentry");
});

test("a chat question fills in what the note is missing before it searches", () => {
  const retrieval = functionBody(read("src/lib/pipeline.ts"), "async function retrieveLectureContext");

  assert.ok(retrieval.indexOf("backfillTranscriptEmbeddings(") > 0);
  assert.ok(
    retrieval.indexOf("backfillTranscriptEmbeddings(") < retrieval.indexOf('"match_transcript_segments"'),
  );
  assert.match(retrieval, /backfillTranscriptEmbeddings\([\s\S]*?\}\)\.catch\(/, "a failed backfill costs nothing");
});

test("a backfill never re-inserts a row: it updates, and only while still empty", () => {
  const body = read("src/lib/transcript-embeddings.ts");

  assert.doesNotMatch(body, /\.upsert\(/);
  assert.match(body, /\.update\(\{ embedding: serializeVector\(values\) \} as never\)\s*\.eq\("id", row\.id\)\s*\.is\("embedding", null\)/);
});

test("the spend cap is recorded on the throwing side of both Inngest stages", () => {
  const stage = functionBody(read("src/lib/pipeline.ts"), "export async function runLectureStage");
  const notes = functionBody(read("src/inngest/functions.ts"), "async function runNotesStageWithGuard");

  assert.match(stage, /!isExpectedLectureInputFailure\(error\) && !isAiProviderSpendCapError\(error\)/);
  assert.match(stage, /await markLecturePipelineFailed\(/);
  assert.match(notes, /isAiProviderSpendCapError\(error\)\s*\) \{\s*await markLecturePipelineFailed/);
  // The step's return shape is unchanged, so a run in flight across the deploy replays as before.
  assert.match(notes, /return \{ completed: false \};/);
});
