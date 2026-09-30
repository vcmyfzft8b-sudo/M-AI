import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findTranscriptCoverageShortfall } from "../src/lib/transcription/coverage.ts";

/*
 * Sentry MEMOAI-WEB-4T, 2026-09-29: lecture 4bdce725, an 87-minute recording (the file really is
 * 87:00) whose talking ended at about 65:40 and whose tail is typing and rustling. Soniox stopped
 * at 3938 s, the coverage check failed the lecture as "incomplete", and each Inngest attempt of
 * the transcribe step paid to transcribe all 87 minutes again to the same answer.
 */

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

test("an hour of lecture followed by quiet minutes the provider processed is covered", () => {
  assert.equal(
    findTranscriptCoverageShortfall({
      transcript: transcriptEndingAt(3_938_000, 5_220_000),
      expectedDurationSeconds: 5_222,
    }),
    null,
  );
});

test("a transcript that still falls short is reported, not refused", () => {
  assert.deepEqual(
    findTranscriptCoverageShortfall({
      transcript: transcriptEndingAt(3_900_000, null),
      expectedDurationSeconds: 5_200,
    }),
    { expectedSeconds: 5_200, lastWordSeconds: 3_900, providerAudioSeconds: null },
  );
  assert.deepEqual(
    findTranscriptCoverageShortfall({
      transcript: transcriptEndingAt(3_900_000, 4_000_000),
      expectedDurationSeconds: 5_200,
    }),
    { expectedSeconds: 5_200, lastWordSeconds: 3_900, providerAudioSeconds: 4_000 },
  );
});

test("short recordings and recordings of unknown length are not judged", () => {
  for (const expectedDurationSeconds of [null, 0, 45]) {
    assert.equal(
      findTranscriptCoverageShortfall({
        transcript: transcriptEndingAt(10_000, null),
        expectedDurationSeconds,
      }),
      null,
    );
  }
});

test("an empty transcript is refused however long the audio", () => {
  assert.throws(
    () =>
      findTranscriptCoverageShortfall({
        transcript: { text: " ", durationSeconds: 600, audioDurationMs: 600_000, segments: [] },
        expectedDurationSeconds: 600,
      }),
    /Transcript is empty\./,
  );
});

test("the pipeline keeps a short transcript and logs it outside the triage prefix", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/lib/pipeline.ts", import.meta.url)),
    "utf8",
  );

  assert.doesNotMatch(source, /Transcript appears incomplete/);
  assert.doesNotMatch(source, /function assertTranscriptCoverage/);

  const warn = source.match(/^.*Transcript ends before the recording does.*$/m);

  assert.ok(warn, "a shortfall must stay visible in the platform log");
  assert.ok(!warn[0].includes("[lecture-pipeline]"), warn[0]);
});
