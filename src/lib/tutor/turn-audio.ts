// The parts of the voice tutor that are decisions rather than plumbing: where an interrupted turn
// was actually cut off, whether what the microphone heard was the tutor's own voice coming back,
// and when a run of loud frames counts as somebody starting to speak.
//
// Kept free of "@/" imports and of every browser global so the unit tests can load it directly.

/** One character of synthesized speech and when it is heard, as Soniox streams it. */
export type SpeechCharacterTimings = {
  characters: string[];
  startSeconds: number[];
  endSeconds: number[];
};

export function createEmptyCharacterTimings(): SpeechCharacterTimings {
  return { characters: [], startSeconds: [], endSeconds: [] };
}

/**
 * Appends one frame of character timestamps to the running map for a turn.
 *
 * The server sends these alongside the audio, one frame at a time, each covering
 * the characters spoken in that frame. Concatenated they are the model's own
 * text with a time against every character.
 */
export function appendCharacterTimings(
  timings: SpeechCharacterTimings,
  frame: {
    characters?: unknown;
    character_start_times_seconds?: unknown;
    character_end_times_seconds?: unknown;
  },
): SpeechCharacterTimings {
  const characters = Array.isArray(frame.characters) ? frame.characters : [];
  const starts = Array.isArray(frame.character_start_times_seconds)
    ? frame.character_start_times_seconds
    : [];
  const ends = Array.isArray(frame.character_end_times_seconds)
    ? frame.character_end_times_seconds
    : [];
  const count = Math.min(characters.length, starts.length, ends.length);

  for (let index = 0; index < count; index += 1) {
    const character = characters[index];
    const start = starts[index];
    const end = ends[index];

    if (typeof character !== "string" || typeof start !== "number" || typeof end !== "number") {
      continue;
    }

    timings.characters.push(character);
    timings.startSeconds.push(start);
    timings.endSeconds.push(end);
  }

  return timings;
}

/**
 * What the learner actually heard before they cut in.
 *
 * This is the whole reason the turn is synthesized with timestamps. When
 * somebody interrupts, the tutor has usually *generated* a good deal more than
 * it has *said* — synthesis runs faster than speech, so a turn can be complete
 * in the buffer while the voice is still two sentences from the end. Recording
 * the generated text as "already covered" would make the tutor skip material
 * the learner never heard; recording nothing would make it repeat itself. So
 * the cut is made at the last character whose audio had already played, and the
 * result is trimmed back to a word boundary so the record does not end
 * mid-word.
 *
 * `null` timings (a stream that sent none) fall back to the whole text, which
 * is the safer of the two errors: repeating is worse than skipping.
 */
export function spokenTextBefore(
  timings: SpeechCharacterTimings | null,
  playedSeconds: number,
  fullText: string,
) {
  if (!timings || timings.characters.length === 0) {
    return stripAudioTags(fullText);
  }

  let spoken = "";

  for (let index = 0; index < timings.characters.length; index += 1) {
    if (timings.startSeconds[index] > playedSeconds) {
      break;
    }

    spoken += timings.characters[index];
  }

  if (spoken.length === 0) {
    return "";
  }

  /*
   * A cut that landed inside a word is pulled back to the last whole one:
   * "the mitochondrion is the powerho" in the record of what was said reads to
   * the model as a typo to be explained rather than as a sentence somebody
   * interrupted. A turn that simply ran to its end is left alone — trimming
   * that would throw away its final word every time.
   */
  const cutMidWord =
    spoken.length < timings.characters.length &&
    !/\s$/u.test(spoken) &&
    !/^\s/u.test(timings.characters[spoken.length] ?? " ");

  if (!cutMidWord) {
    return stripAudioTags(spoken);
  }

  const lastBoundary = spoken.search(/\s\S*$/u);

  return stripAudioTags(lastBoundary > 0 ? spoken.slice(0, lastBoundary) : "");
}

/**
 * Removes the synthesizer's audio tags from a record of what was said.
 *
 * `[laughs]` and its siblings are performed as sounds and never spoken, but they do come
 * back in the character timestamps — which is where the record of what the learner heard
 * comes from. Left in, they would end up in the conversation history as though the tutor
 * had said the word "laughs", and the model would quite reasonably start explaining it.
 */
export function stripAudioTags(text: string) {
  return text
    .replace(/\[[^\]]{0,40}\]/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

const WORD_PATTERN = /\p{Letter}[\p{Letter}\p{Mark}'’-]*/gu;

function allWords(value: string) {
  return value.toLowerCase().match(WORD_PATTERN) ?? [];
}

/*
 * Words long enough to identify a sentence by. The short ones are the same in
 * every sentence of a language — "je", "in", "the", "is" — so counting them
 * towards an echo match would make every question look like the tutor's own
 * voice coming back.
 */
function contentWords(value: string) {
  return allWords(value).filter((word) => word.length > 2);
}

/**
 * Whether what the microphone just heard is the tutor's own voice coming back.
 *
 * The browser's echo canceller removes most of it, and headphones remove all of
 * it, but a phone held at arm's length on speaker still leaks — and a tutor that
 * interrupts itself every few seconds is unusable. The test is content, not
 * volume: if nearly every word the recognizer heard is a word the tutor has just
 * said, it is the room, not the learner.
 *
 * The bar is deliberately high (four fifths) and short utterances are exempt,
 * because the cost of the two mistakes is not symmetric. Ignoring a real
 * interruption is the worse one: the learner has to say it twice. Acting on a
 * stray echo only costs a pause.
 */
export function isEchoOfTutor(heard: string, tutorSpokenTail: string) {
  const heardWords = contentWords(heard);

  if (heardWords.length < 2) {
    return false;
  }

  const tutorWords = new Set(contentWords(tutorSpokenTail));

  if (tutorWords.size === 0) {
    return false;
  }

  const overlap = heardWords.filter((word) => tutorWords.has(word)).length;

  return overlap / heardWords.length >= 0.8;
}

/**
 * How much of an interruption has to be heard before the tutor gives up its turn.
 *
 * "Mhm" and a cough are not interruptions; a question is. Anything that reaches
 * two words or a dozen characters is treated as one, which in testing was the
 * line between a learner agreeing and a learner asking.
 */
export function isSubstantialInterruption(heard: string) {
  const trimmed = heard.trim();

  /*
   * Every word counts here, short ones included — unlike the echo test above.
   * "ne razumem" is two short words and is exactly the interruption that must
   * always work; dropping its first word would leave it below the bar.
   */
  return trimmed.length >= 12 || allWords(trimmed).length >= 2;
}

export type VoiceActivityOptions = {
  /** Frames of speech-level audio before it counts as speech. At ~21ms a frame, three is ~64ms. */
  attackFrames?: number;
  /** Frames of quiet before speech counts as over. */
  releaseFrames?: number;
  /** The floor below which nothing is speech however quiet the room is. */
  absoluteThreshold?: number;
  /** How far above the measured room noise a frame has to sit. */
  noiseMultiplier?: number;
};

/**
 * The energy detector that makes barge-in feel instant.
 *
 * Waiting for the recognizer to send a word back costs a network round trip plus
 * whatever the model needs to be sure — several hundred milliseconds during
 * which the tutor is still cheerfully talking over the learner. That is the
 * single thing that makes a voice agent feel like a machine. So the microphone
 * is watched locally: the moment its level rises above the room, the tutor
 * ducks, and the recognizer's words a moment later decide whether that becomes a
 * full interruption or the tutor simply carries on.
 *
 * The threshold rides on the measured noise floor rather than being a constant,
 * because a quiet bedroom and a café differ by more than any single number can
 * straddle. The floor tracks downward quickly and upward slowly, so a fan is
 * learned in a second and a sentence never becomes the new definition of quiet.
 */
export class VoiceActivityDetector {
  private noiseFloor = 0.01;
  private loudFrames = 0;
  private quietFrames = 0;
  private active = false;

  private readonly attackFrames: number;
  private readonly releaseFrames: number;
  private readonly absoluteThreshold: number;
  private readonly noiseMultiplier: number;

  constructor(options: VoiceActivityOptions = {}) {
    this.attackFrames = options.attackFrames ?? 3;
    this.releaseFrames = options.releaseFrames ?? 24;
    this.absoluteThreshold = options.absoluteThreshold ?? 0.012;
    this.noiseMultiplier = options.noiseMultiplier ?? 2.6;
  }

  get isSpeaking() {
    return this.active;
  }

  get threshold() {
    return Math.max(this.absoluteThreshold, this.noiseFloor * this.noiseMultiplier);
  }

  /** Feeds one frame's RMS level in. Returns a transition, or null when nothing changed. */
  push(level: number): "start" | "end" | null {
    const loud = level > this.threshold;

    if (!loud) {
      // Down fast, up slow: a quiet moment redefines the floor, a loud one barely moves it.
      this.noiseFloor = this.noiseFloor * 0.95 + level * 0.05;
    } else {
      this.noiseFloor = this.noiseFloor * 0.999 + level * 0.001;
    }

    if (loud) {
      this.loudFrames += 1;
      this.quietFrames = 0;
    } else {
      this.quietFrames += 1;
      this.loudFrames = 0;
    }

    if (!this.active && this.loudFrames >= this.attackFrames) {
      this.active = true;
      return "start";
    }

    if (this.active && this.quietFrames >= this.releaseFrames) {
      this.active = false;
      return "end";
    }

    return null;
  }

  reset() {
    this.loudFrames = 0;
    this.quietFrames = 0;
    this.active = false;
  }
}

/**
 * Splits a stream of model deltas into pieces that are safe to synthesize.
 *
 * The speech socket takes text incrementally, which is what lets the tutor start
 * talking while the rest of the turn is still being written — but a piece cut
 * mid-word is pronounced as two words, and the seam is audible. Holding back
 * everything after the last space costs a few characters of latency and removes
 * the seam entirely.
 */
export class SpeechTextBuffer {
  private pending = "";

  /** Returns the part that is safe to send now, holding back a possible half-word. */
  push(delta: string) {
    this.pending += delta;

    const boundary = this.pending.search(/\s\S*$/u);

    if (boundary < 0) {
      return "";
    }

    const ready = this.pending.slice(0, boundary + 1);
    this.pending = this.pending.slice(boundary + 1);

    return ready;
  }

  /** Everything held back, for when the turn ends. */
  flush() {
    const rest = this.pending;
    this.pending = "";

    return rest;
  }
}

/**
 * Turns a jittery audio level into something worth watching.
 *
 * The raw RMS of speech is spiky — it drops to near zero between syllables and
 * inside every stop consonant — so a shape driven straight from it flickers
 * rather than breathes. What the eye wants is the *envelope*: rise with the
 * voice, fall slower than it.
 *
 * Asymmetric on purpose, and the asymmetry is the whole trick. Attack is fast so
 * the sphere answers the first syllable rather than lagging behind the sentence;
 * release is slow so the gaps between words do not read as the tutor stopping.
 * The same shape a compressor or a VU meter uses, for the same reason.
 */
export class LevelEnvelope {
  private value = 0;
  private readonly attack: number;
  private readonly release: number;

  // Declared rather than written as parameter properties: the unit tests load this module
  // through Node's strip-only TypeScript, which rejects those outright.
  constructor(attack = 0.35, release = 0.08) {
    this.attack = attack;
    this.release = release;
  }

  /** Feeds one frame's level in and returns the smoothed value. */
  push(level: number) {
    const coefficient = level > this.value ? this.attack : this.release;
    this.value += (level - this.value) * coefficient;

    // Denormals are pointless work and keep the shape imperceptibly alive forever.
    if (this.value < 0.0005) {
      this.value = 0;
    }

    return this.value;
  }

  reset() {
    this.value = 0;
  }
}
