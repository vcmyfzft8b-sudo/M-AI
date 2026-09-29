import assert from "node:assert/strict";
import test from "node:test";

import { assertTranscriptCoverage } from "../src/lib/transcription/coverage.ts";

function transcriptEndingAt(lastEndMs, audioDurationMs) {
  return {
    text: "Prva misel. Druga misel.",
    durationSeconds: Math.round((audioDurationMs ?? lastEndMs) / 1000),
    audioDurationMs,
    segments: [
      { startMs: 0, endMs: lastEndMs / 2, text: "Prva misel." },
      { startMs: lastEndMs / 2, endMs: lastEndMs, text: "Druga misel." },
    ],
  };
}

test("an hour of lecture followed by twenty quiet minutes the provider processed is covered", () => {
  assert.doesNotThrow(() =>
    assertTranscriptCoverage({
      transcript: transcriptEndingAt(3_900_000, 5_200_000),
      expectedDurationSeconds: 5_200,
    }),
  );
});

test("a transcript that stops short with no word from the provider is still refused", () => {
  assert.throws(
    () =>
      assertTranscriptCoverage({
        transcript: transcriptEndingAt(3_900_000, null),
        expectedDurationSeconds: 5_200,
      }),
    /Transcript appears incomplete\. Expected about 5200s but only covered 3900s\./,
  );
});

test("audio the provider only partly received is still refused", () => {
  assert.throws(
    () =>
      assertTranscriptCoverage({
        transcript: transcriptEndingAt(3_900_000, 4_000_000),
        expectedDurationSeconds: 5_200,
      }),
    /only covered 4000s/,
  );
});

test("an empty transcript is refused however long the audio", () => {
  assert.throws(
    () =>
      assertTranscriptCoverage({
        transcript: { text: " ", durationSeconds: 600, audioDurationMs: 600_000, segments: [] },
        expectedDurationSeconds: 600,
      }),
    /Transcript is empty\./,
  );
});
