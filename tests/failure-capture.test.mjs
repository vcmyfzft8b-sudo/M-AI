import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFailureCaptureRecord,
  MAX_CAPTURE_CHARS,
} from "../src/lib/notes/failure-capture-record.ts";

const base = {
  lectureId: "lec-1",
  userId: "user-1",
  sourceType: "text",
  languageHint: "sl",
  errorMessage: "Gemini structured generation timed out after 240000ms.",
  processingMetadata: null,
  transcriptText: null,
};

test("a manual import is captured from its own metadata, and not duplicated inside it", () => {
  const record = buildFailureCaptureRecord({
    ...base,
    processingMetadata: {
      processing: { stage: "failed" },
      manualImport: { text: "PEDAGOGIKA\n\nPaidos – otrok", blocks: [{ label: "p.1", text: "x" }], sourceType: "text" },
    },
    transcriptText: "should be ignored when manual text exists",
  });

  assert.equal(record.source_text, "PEDAGOGIKA\n\nPaidos – otrok");
  assert.equal(record.source_char_count, record.source_text.length);
  assert.deepEqual(record.source_blocks, [{ label: "p.1", text: "x" }]);
  // The metadata snapshot keeps the flags but not a second copy of the payload.
  assert.equal(record.processing_metadata.manualImport.text, undefined);
  assert.equal(record.processing_metadata.manualImport.blocks, undefined);
  assert.equal(record.processing_metadata.manualImport.sourceType, "text");
  assert.equal(record.processing_metadata.processing.stage, "failed");
});

test("an audio lecture falls back to the transcript", () => {
  const record = buildFailureCaptureRecord({
    ...base,
    sourceType: "audio",
    transcriptText: "segment one\n\nsegment two",
  });

  assert.equal(record.source_text, "segment one\n\nsegment two");
  assert.equal(record.source_blocks, null);
});

test("the snapshot is capped at the intake ceiling and the error message stays short", () => {
  const record = buildFailureCaptureRecord({
    ...base,
    errorMessage: "x".repeat(10_000),
    transcriptText: "y".repeat(MAX_CAPTURE_CHARS + 500),
  });

  assert.equal(record.source_text.length, MAX_CAPTURE_CHARS);
  assert.equal(record.source_char_count, MAX_CAPTURE_CHARS);
  assert.equal(record.error_message.length, 2_000);
});

test("a lecture with no source at all still captures the context row", () => {
  const record = buildFailureCaptureRecord(base);

  assert.equal(record.source_text, null);
  assert.equal(record.source_char_count, 0);
  assert.equal(record.lecture_id, "lec-1");
  assert.equal(record.language_hint, "sl");
});
