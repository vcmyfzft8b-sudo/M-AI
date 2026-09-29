/**
 * How far short of the recording's length a transcript's last word falls, when that is more
 * than a pause.
 *
 * `null` when the transcript reaches the end of the recording, or the recording is too short to
 * judge. Otherwise the expected length and the second the last segment ends at.
 */
export function findTranscriptCoverageShortfall(params: {
  segments: Array<{ endMs: number }>;
  expectedDurationSeconds: number | null;
}) {
  const { segments, expectedDurationSeconds } = params;

  if (!expectedDurationSeconds || expectedDurationSeconds < 60) {
    return null;
  }

  const expectedEndMs = expectedDurationSeconds * 1000;
  const lastSegmentEndMs = segments.reduce(
    (maxEndMs, segment) => Math.max(maxEndMs, segment.endMs),
    0,
  );
  const allowedGapMs = Math.max(30_000, expectedEndMs * 0.05);

  if (expectedEndMs - lastSegmentEndMs <= allowedGapMs) {
    return null;
  }

  return {
    expectedSeconds: expectedDurationSeconds,
    coveredSeconds: Math.round(lastSegmentEndMs / 1000),
  };
}

/**
 * Whether a shortfall means part of the recording was never transcribed.
 *
 * Only a transcript stitched together from separately transcribed chunks can have lost a piece:
 * a chunk that failed leaves a hole the provider never reported. A recording transcribed in one
 * request either completes or errors, so a completed transcript that ends early means the file
 * has no speech after that point (a recorder left running after the lecture) or the file itself
 * ends there. Neither is a transcription failure: retrying transcribes the same file to the same
 * answer, and failing the lecture throws away every minute that was heard.
 */
export function isTranscriptShortfallFatal(params: { stitchedFromChunks: boolean }) {
  return params.stitchedFromChunks;
}
