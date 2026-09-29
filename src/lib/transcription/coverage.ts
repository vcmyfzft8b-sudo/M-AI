/**
 * Refuses a transcript that stops well short of the recording, which is how a provider that
 * dropped part of the audio shows up.
 *
 * A transcript also stops short when the recording simply goes on after the talking ends: a
 * recorder left running in the bag, twenty minutes of typing and chairs after the lecture. That is
 * not a lost transcript, and failing it threw away an hour of lecture. So when the provider reports
 * that it processed the whole recording, the silence after the last word counts as covered.
 */
export function assertTranscriptCoverage(params: {
  transcript: {
    text: string;
    segments: Array<{ startMs: number; endMs: number; text: string }>;
    durationSeconds: number;
    audioDurationMs?: number | null;
  };
  expectedDurationSeconds: number | null;
}) {
  const { transcript, expectedDurationSeconds } = params;

  if (transcript.segments.length === 0 || transcript.text.trim().length === 0) {
    throw new Error("Transcript is empty.");
  }

  if (!expectedDurationSeconds || expectedDurationSeconds < 60) {
    return;
  }

  const expectedEndMs = expectedDurationSeconds * 1000;
  const lastSegmentEndMs = transcript.segments.reduce(
    (maxEndMs, segment) => Math.max(maxEndMs, segment.endMs),
    0,
  );
  const coveredMs = Math.max(lastSegmentEndMs, transcript.audioDurationMs ?? 0);
  const allowedGapMs = Math.max(30_000, expectedEndMs * 0.05);

  if (expectedEndMs - coveredMs > allowedGapMs) {
    throw new Error(
      `Transcript appears incomplete. Expected about ${expectedDurationSeconds}s but only covered ${Math.round(coveredMs / 1000)}s.`,
    );
  }
}
