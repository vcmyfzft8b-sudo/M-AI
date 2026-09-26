import assert from "node:assert/strict";
import test from "node:test";

import { resolveNoteSourceNotices } from "../src/lib/note-source-notice.ts";

test("an ordinary note says nothing about how it was made", () => {
  assert.deepEqual(
    resolveNoteSourceNotices({ artifactMetadata: { notesMode: "content" }, processingMetadata: {} }),
    [],
  );
});

test("topic notes say what the material was", () => {
  const notice = (materialKind) =>
    resolveNoteSourceNotices({
      artifactMetadata: { notesMode: "topic", topicNotes: { materialKind, topicTitle: "X" } },
      processingMetadata: {},
    })[0].key;

  assert.equal(notice("exercises"), "note.sourceNotice.topicExercises");
  assert.equal(notice("question_or_request"), "note.sourceNotice.topicQuestion");
  assert.equal(notice("list_or_outline"), "note.sourceNotice.topicOther");
});

test("missing photos are counted against the whole set", () => {
  const [notice] = resolveNoteSourceNotices({
    artifactMetadata: {},
    processingMetadata: {
      uploadSalvage: { expected: 5, arrived: 3, missing: 2 },
      manualImport: {
        modelMetadata: {
          missingImageCount: 2,
          sourceImageUploads: [{}, {}, {}],
        },
      },
    },
  });

  assert.equal(notice.key, "note.sourceNotice.missingPhotos");
  assert.deepEqual(notice.params, { missing: 2, total: 5 });
});
