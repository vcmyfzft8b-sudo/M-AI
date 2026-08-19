// A lecture reaches `preparing_audio` only after its notes are written to `lecture_artifacts` and
// the artifact's enrichment is marked complete. Everything from that point on is the optional
// initial note audio, which `prepareInitialNoteTtsChunksSafely` already treats as best-effort: the
// note player prepares its first chunk on demand when the pipeline could not.
//
// Kept as a leaf module with no imports so the stage that writes it and the failure path that reads
// it cannot drift apart, and so both can be asserted in a test.

/** The processing stage that means "notes are done, only the optional audio is left". */
export const INITIAL_NOTE_AUDIO_STAGE = "preparing_audio";

export function getLectureProcessingStage(processingMetadata: unknown) {
  if (!processingMetadata || typeof processingMetadata !== "object") {
    return null;
  }

  const processing = (processingMetadata as Record<string, unknown>).processing;

  if (!processing || typeof processing !== "object") {
    return null;
  }

  const stage = (processing as Record<string, unknown>).stage;

  return typeof stage === "string" ? stage : null;
}

/**
 * True when the lecture already has finished notes and the pipeline was inside the optional initial
 * audio step. A failure raised here costs the learner nothing, so it must not bury the notes.
 */
export function isPreparingInitialNoteAudio(processingMetadata: unknown) {
  return getLectureProcessingStage(processingMetadata) === INITIAL_NOTE_AUDIO_STAGE;
}
