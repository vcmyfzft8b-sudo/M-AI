// When the one line under the sphere — what the microphone heard the learner say — is on
// screen, and when a revision from the recognizer is allowed to change it.
//
// The rule lives here rather than in the component because it is a rule and not a render:
// three places have to agree about it (the partials that write the line, the phase change
// that takes it down, and the markup that draws it), and three copies of a rule is how the
// tutor ended up spelling its own sentence out under the sphere as if the learner had said it.
//
// Kept free of "@/" imports and of every browser global so the unit tests can load it directly.

/** Where the walkthrough is, which is the same thing as who is holding the floor. */
export type TutorPhase =
  | "idle"
  | "preparing"
  | "thinking"
  | "speaking"
  | "listening"
  | "paused"
  | "finished";

/**
 * Whether a revision from the recognizer reaches the line.
 *
 * Only while the learner holds the floor. The microphone hears the room rather than the
 * learner, so while the tutor is talking these revisions are as often its own voice coming
 * back through the speakers as anybody speaking — and the moment somebody genuinely cuts in,
 * the floor is handed over first and the words go up with it.
 */
export function acceptsHeardLine(phase: TutorPhase): boolean {
  return phase === "listening";
}

/**
 * Whether the line is drawn.
 *
 * From the first word they say until the tutor answers out loud. Thinking still counts as
 * their turn — it is the beat where they read back what was heard — but a voice in the room
 * does not: the tutor talking over the learner's own last sentence reads as it quoting them,
 * and puts words on the screen at exactly the moment everything else is arranged to keep
 * them off it.
 */
export function showsHeardLine(phase: TutorPhase): boolean {
  return phase === "listening" || phase === "thinking";
}

/**
 * Whether arriving at this phase empties the line.
 *
 * Emptied rather than merely hidden, because the floor comes back: a line that was only
 * hidden while the tutor spoke would reappear when the tutor stopped, printing an old
 * question over a new silence.
 */
export function clearsHeardLine(phase: TutorPhase): boolean {
  return !showsHeardLine(phase);
}

/** Only the current sentence belongs in the subtitle; the full utterance still goes to the tutor. */
export function latestHeardSentence(text: string, language: string): string {
  const sentences = new Intl.Segmenter(language, { granularity: "sentence" }).segment(text.trim());
  let latest = "";
  for (const { segment } of sentences) {
    if (segment.trim()) latest = segment.trim();
  }
  return latest;
}
