// The parts of the voice tutor that are decisions rather than plumbing: where an interrupted turn
// was actually cut off, whether what the microphone heard was a word or a noise, and whether it
// was the tutor's own voice coming back.
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
 * Sounds people make that are not words: the noise of agreement, of thinking, of
 * clearing a throat. The recognizer transcribes them, because they are what it
 * heard, but a learner saying "mhm" while the tutor talks has not asked for the
 * floor — and a tutor that stops for one is a tutor that stops constantly.
 *
 * Matched on the letters with their runs flattened, so "hmmmm" and "hm" and
 * "mmm" are one entry rather than a list of spellings nobody can finish.
 */
const BACKCHANNEL = new Set([
  "a",
  "aha",
  "ah",
  "e",
  "eh",
  "ehm",
  "em",
  "er",
  "erm",
  "h",
  "ha",
  "hm",
  "m",
  "mh",
  "mhm",
  "o",
  "oh",
  "u",
  "uh",
  "uhm",
  "um",
]);

/** "hmmmm" and "hm" are the same sound; this is what makes them the same string. */
function flattenRuns(word: string) {
  return word.replace(/(.)\1+/gu, "$1");
}

/** Whether one transcribed token is a word rather than a noise. */
function isWord(word: string) {
  return word.length >= 2 && !BACKCHANNEL.has(flattenRuns(word));
}

/**
 * Whether the recognizer heard an actual word.
 *
 * This is the whole test for taking the floor, and one word passes it. The tutor
 * used to give way on energy — the microphone hearing something voice-shaped was
 * enough to drop its voice to a whisper while the recognizer caught up — and the
 * result was a lesson that flinched at a door, a car, a dog and a sibling in the
 * next room. Nothing about a sound tells you whether a person is talking *to
 * you*; the words do, and they are the only thing here that decides.
 *
 * Waiting for the recognizer costs a few hundred milliseconds of the tutor still
 * talking after the learner starts. That is the price of never stopping for a
 * noise, and it is the right way round: a tutor that keeps going for a moment
 * reads as a person finishing their sentence, and a tutor that stops at nothing
 * reads as broken.
 */
export function hasSpokenWord(heard: string) {
  return allWords(heard).some(isWord);
}

/*
 * Two words are the same word for echo purposes when they are the same string, or
 * when one sits inside the other — the recognizer splits and joins the tutor's words
 * as it pleases when what it is transcribing is a speaker rather than a person, so
 * "mitohondrij" comes back as "mito hondrij" and "elektrarna" as "elektrarn". An echo
 * that fails to match because of a seam is an echo that stops the lesson.
 *
 * Four letters before a fragment counts, which is long enough that a learner's own
 * short word cannot be swallowed by a long one of the tutor's.
 */
const ECHO_STEM_LENGTH = 4;

function isSameWord(heard: string, spoken: string) {
  if (heard === spoken) {
    return true;
  }

  const shorter = Math.min(heard.length, spoken.length);

  return shorter >= ECHO_STEM_LENGTH && (heard.includes(spoken) || spoken.includes(heard));
}

/**
 * Whether what the microphone heard is the tutor's own voice coming back.
 *
 * The browser's echo canceller removes most of it and headphones remove all of
 * it, but a phone at arm's length on speaker leaks — and now that a single word
 * takes the floor, one leaked word would stop the lesson. So the test is strict
 * in the direction that matters: if *every* word heard is a word the tutor has
 * already said aloud in this turn, it is the room, and the tutor is deaf to it.
 *
 * Strictness is affordable because of what is passed in. `tutorSpokenTail` is
 * what has actually left the speaker and is empty as soon as the room has been
 * quiet for a moment — so this only ever judges the learner while the tutor's
 * voice is genuinely in the air with them. During their own turn nothing is
 * filtered at all, and they can say anything, including the tutor's own words
 * back to it.
 *
 * What it costs: a learner whose entire interruption is one word the tutor has
 * just said is not heard, and has to say something else. Set against a tutor
 * that interrupts itself, that is the cheaper of the two.
 */
export function isTutorEcho(heard: string, tutorSpokenTail: string) {
  const spoken = allWords(tutorSpokenTail);

  if (spoken.length === 0) {
    return false;
  }

  /*
   * Noises are not evidence of a learner: the recognizer sprinkles "mhm" and
   * "ah" through a speaker's leaked voice as readily as through a person's, and
   * one of them in the middle of an echo must not turn the whole thing into an
   * interruption.
   */
  const words = allWords(heard).filter(isWord);

  if (words.length === 0) {
    return true;
  }

  return words.every((word) => spoken.some((said) => isSameWord(word, said)));
}

/** Who the microphone was listening to. */
export type HeardSpeaker = "learner" | "tutor" | "noise";

/**
 * The whole of the interruption policy, in one place.
 *
 * Everything the recognizer sends up is one of three things, and only one of them
 * stops the lesson:
 *
 *   - "noise": the room, or a person agreeing without asking for anything. Ignored.
 *   - "tutor": its own voice off a speaker. Ignored, and the caller drops it from the
 *     recognizer's buffer as well, or it waits there for the learner's next question
 *     to be glued onto the end of it.
 *   - "learner": somebody said a word. The floor is theirs, immediately, on one word.
 *
 * `tutorSpokenTail` is what the tutor's voice has actually put into the room, and it
 * is empty whenever the room has been the learner's for a moment — which is what
 * makes it safe for the echo test to be as strict as it is.
 */
export function judgeHeard(heard: string, tutorSpokenTail: string): HeardSpeaker {
  if (!hasSpokenWord(heard)) {
    return "noise";
  }

  return isTutorEcho(heard, tutorSpokenTail) ? "tutor" : "learner";
}

/**
 * The loudness of one frame of microphone audio, for the ring around the sphere.
 *
 * Plain RMS. This used to be one output of a filter bank that split every frame
 * into rumble, voice and hiss so that a local detector could guess whether a
 * sound was a person before the recognizer could say — the machinery that made
 * the tutor duck at a passing car. The words decide now, so the bands measured
 * nothing anybody asked, and the only number still wanted is how loud it was.
 *
 * Int16 is what the recorder hands over; Float32 is what tests use.
 */
export function frameLevel(samples: Int16Array | Float32Array) {
  const scale = samples instanceof Float32Array ? 1 : 1 / 0x8000;
  let total = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] * scale;

    total += sample * sample;
  }

  return Math.sqrt(total / (samples.length || 1));
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
