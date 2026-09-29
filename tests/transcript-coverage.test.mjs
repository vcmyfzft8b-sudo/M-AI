import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  findTranscriptCoverageShortfall,
  isTranscriptShortfallFatal,
} from "../src/lib/transcript-coverage.ts";

const PIPELINE_SOURCE = readFileSync(
  fileURLToPath(new URL("../src/lib/pipeline.ts", import.meta.url)),
  "utf8",
);

function segmentsEndingAt(seconds) {
  return [
    { endMs: 60_000 },
    { endMs: seconds * 1000 },
  ];
}

test("a transcript that reaches the end of the recording has no shortfall", () => {
  assert.equal(
    findTranscriptCoverageShortfall({
      segments: segmentsEndingAt(5_100),
      expectedDurationSeconds: 5_222,
    }),
    null,
  );
  assert.equal(
    findTranscriptCoverageShortfall({ segments: segmentsEndingAt(10), expectedDurationSeconds: 45 }),
    null,
    "too short to judge",
  );
  assert.equal(
    findTranscriptCoverageShortfall({ segments: segmentsEndingAt(10), expectedDurationSeconds: null }),
    null,
  );
});

// The production event (Sentry MEMOAI-WEB-4T, 2026-09-29): an 87-minute recording whose last
// words came at 65 minutes. Soniox transcribed it in one request and completed, and the lecture
// failed after five paid transcriptions of the same file, each ending in the same place.
test("a single-request transcript that ends early is kept, not failed", () => {
  const shortfall = findTranscriptCoverageShortfall({
    segments: segmentsEndingAt(3_938),
    expectedDurationSeconds: 5_222,
  });

  assert.deepEqual(shortfall, { expectedSeconds: 5_222, coveredSeconds: 3_938 });
  assert.equal(isTranscriptShortfallFatal({ stitchedFromChunks: false }), false);
});

test("a transcript stitched from chunks that ends early has lost a chunk", () => {
  assert.equal(isTranscriptShortfallFatal({ stitchedFromChunks: true }), true);
});

test("the pipeline tells the coverage check how the transcript was made", () => {
  assert.match(
    PIPELINE_SOURCE,
    /const stitchedFromChunks = audioChunks\.length > 0 && Boolean\(transcriptionProvider\.transcribeChunks\);/,
  );
  assert.match(
    PIPELINE_SOURCE,
    /assertTranscriptCoverage\(\{[^}]*stitchedFromChunks,\s*\}\);/,
  );
  assert.match(PIPELINE_SOURCE, /isTranscriptShortfallFatal\(\{ stitchedFromChunks: params\.stitchedFromChunks \}\)/);
});
