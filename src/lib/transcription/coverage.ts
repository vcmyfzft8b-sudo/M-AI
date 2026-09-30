/**
 * How far a transcript falls short of the recording, when that is more than a pause.
 *
 * A transcript stops short when the recording simply goes on after the talking ends: a recorder
 * left running in the bag, twenty minutes of typing and chairs after the lecture. So when the
 * provider reports that it processed the whole recording, the silence after the last word counts
 * as covered, and there is nothing to report.
 *
 * What is left is reported, never refused. The recording is transcribed in one request that
 * either completes or throws, so a completed transcript that still falls short holds everything
 * the file has to give: retrying pays to transcribe the same file to the same answer (inside the
 * Inngest step, once per step attempt), and failing throws away every minute that was heard. That
 * is how lecture 4bdce725 lost 65 minutes of lecture on 2026-09-29 (Sentry MEMOAI-WEB-4T). Only an
 * empty transcript fails.
 */
export function findTranscriptCoverageShortfall(params: {
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
    return null;
  }

  const expectedEndMs = expectedDurationSeconds * 1000;
  const lastSegmentEndMs = transcript.segments.reduce(
    (maxEndMs, segment) => Math.max(maxEndMs, segment.endMs),
    0,
  );
  const coveredMs = Math.max(lastSegmentEndMs, transcript.audioDurationMs ?? 0);
  const allowedGapMs = Math.max(30_000, expectedEndMs * 0.05);

  if (expectedEndMs - coveredMs <= allowedGapMs) {
    return null;
  }

  return {
    expectedSeconds: expectedDurationSeconds,
    lastWordSeconds: Math.round(lastSegmentEndMs / 1000),
    providerAudioSeconds:
      transcript.audioDurationMs == null ? null : Math.round(transcript.audioDurationMs / 1000),
  };
}
