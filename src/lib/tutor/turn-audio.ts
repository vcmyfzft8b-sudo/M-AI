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

/**
 * Where one frame of microphone audio sat in the spectrum.
 *
 * Three bands, because "was that a person" is a question about shape rather than
 * about volume. A voice lives between roughly 300 Hz and 3 kHz. Underneath it
 * sits everything a room does on its own — a car, a fan, wind, a knock on the
 * desk — and above it sits everything a room's *objects* do: crumpling paper, a
 * keyboard, a spoon against a cup. Loudness alone cannot tell those apart from a
 * question, which is why measuring only loudness made the tutor go quiet every
 * time somebody turned a page.
 */
export type SpeechBandLevels = {
  /** RMS of the frame as it arrived, for the ring around the sphere. */
  level: number;
  /** RMS of the 300–3000 Hz band, where a voice is. */
  voice: number;
  /** RMS below ~250 Hz: a car, a fan, wind, a thump on the table. */
  rumble: number;
  /** RMS above ~4 kHz: crumpling paper, a keyboard, a spoon in a cup. */
  hiss: number;
};

const VOICE_BAND_LOW_HZ = 300;
const VOICE_BAND_HIGH_HZ = 3000;
const RUMBLE_HZ = 250;
const HISS_HZ = 4000;

/**
 * One second-order filter section, in the usual audio arrangement.
 *
 * A biquad rather than the two-line leaky integrator it is tempting to reach
 * for, because the context runs at whatever rate the hardware gives — 48 kHz on
 * most machines, but 16 kHz on a phone with a Bluetooth headset, and there a
 * one-pole highpass at 4 kHz stops being a highpass at all and quietly reports
 * that every sound in the room is a voice. These coefficients (Robert
 * Bristow-Johnson's, Butterworth Q) behave the same way at any rate.
 */
class Biquad {
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;

  private first = 0;
  private second = 0;

  private constructor(coefficients: [number, number, number, number, number]) {
    [this.b0, this.b1, this.b2, this.a1, this.a2] = coefficients;
  }

  static lowpass(cutoffHz: number, sampleRate: number) {
    const { cosine, alpha, scale } = Biquad.shape(cutoffHz, sampleRate);
    const shared = (1 - cosine) / 2;

    return new Biquad([
      shared / scale,
      (1 - cosine) / scale,
      shared / scale,
      (-2 * cosine) / scale,
      (1 - alpha) / scale,
    ]);
  }

  static highpass(cutoffHz: number, sampleRate: number) {
    const { cosine, alpha, scale } = Biquad.shape(cutoffHz, sampleRate);
    const shared = (1 + cosine) / 2;

    return new Biquad([
      shared / scale,
      -(1 + cosine) / scale,
      shared / scale,
      (-2 * cosine) / scale,
      (1 - alpha) / scale,
    ]);
  }

  private static shape(cutoffHz: number, sampleRate: number) {
    // Held below Nyquist: a cutoff at or above it has no meaning and the coefficients blow up.
    const angle = (2 * Math.PI * Math.min(cutoffHz, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(angle) / Math.SQRT2;

    return { cosine: Math.cos(angle), alpha, scale: 1 + alpha };
  }

  process(sample: number) {
    const output = this.b0 * sample + this.first;
    this.first = this.b1 * sample - this.a1 * output + this.second;
    this.second = this.b2 * sample - this.a2 * output;

    return output;
  }

  reset() {
    this.first = 0;
    this.second = 0;
  }
}

/**
 * Splits each frame of microphone audio into those three bands.
 *
 * Four filter sections rather than an FFT, deliberately. This runs on every 20ms
 * frame for the whole session, and 12 dB/octave is already far more than it
 * takes to tell a car apart from a question — the bands only have to be
 * *comparable*, not clean. An FFT would cost more and decide nothing differently.
 *
 * The filter state carries across frames. Resetting it per frame would put a
 * step discontinuity at the start of every one, and those clicks are precisely
 * the thing being measured away.
 */
export class SpeechBandAnalyser {
  private readonly rumbleFilter: Biquad;
  private readonly hissFilter: Biquad;
  private readonly voiceFloorFilter: Biquad;
  private readonly voiceCeilingFilter: Biquad;

  constructor(sampleRate: number) {
    this.rumbleFilter = Biquad.lowpass(RUMBLE_HZ, sampleRate);
    this.hissFilter = Biquad.highpass(HISS_HZ, sampleRate);
    this.voiceFloorFilter = Biquad.highpass(VOICE_BAND_LOW_HZ, sampleRate);
    this.voiceCeilingFilter = Biquad.lowpass(VOICE_BAND_HIGH_HZ, sampleRate);
  }

  /** Measures one frame. Int16 is what the recorder hands over; Float32 is what tests use. */
  measure(samples: Int16Array | Float32Array): SpeechBandLevels {
    const scale = samples instanceof Float32Array ? 1 : 1 / 0x8000;

    let total = 0;
    let voice = 0;
    let rumble = 0;
    let hiss = 0;

    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index] * scale;
      const inRumble = this.rumbleFilter.process(sample);
      const inHiss = this.hissFilter.process(sample);
      const inVoice = this.voiceCeilingFilter.process(this.voiceFloorFilter.process(sample));

      total += sample * sample;
      rumble += inRumble * inRumble;
      hiss += inHiss * inHiss;
      voice += inVoice * inVoice;
    }

    const count = samples.length || 1;

    return {
      level: Math.sqrt(total / count),
      voice: Math.sqrt(voice / count),
      rumble: Math.sqrt(rumble / count),
      hiss: Math.sqrt(hiss / count),
    };
  }

  reset() {
    this.rumbleFilter.reset();
    this.hissFilter.reset();
    this.voiceFloorFilter.reset();
    this.voiceCeilingFilter.reset();
  }
}

export type VoiceActivityOptions = {
  /** Frames of voice-shaped audio before it counts as speech. At 20ms a frame, five is 100ms. */
  attackFrames?: number;
  /** Frames of quiet before speech counts as over. */
  releaseFrames?: number;
  /** The floor below which nothing is speech however quiet the room is. */
  absoluteThreshold?: number;
  /** How far above the measured room noise a frame has to sit. */
  noiseMultiplier?: number;
  /** How much louder than the voice band the rumble beneath it may be. */
  rumbleTolerance?: number;
  /** How much louder than the voice band the hiss above it may be. */
  hissTolerance?: number;
  /** Frames per block of the noise floor's memory. It looks back one to two blocks. */
  floorWindowFrames?: number;
};

/**
 * The detector that makes barge-in feel instant without making it hysterical.
 *
 * Waiting for the recognizer to send a word back costs a network round trip plus
 * whatever the model needs to be sure — several hundred milliseconds during
 * which the tutor is still cheerfully talking over the learner. That is the
 * single thing that makes a voice agent feel like a machine. So the microphone
 * is watched locally: the moment it hears something shaped like a voice, the
 * tutor ducks, and the recognizer's words a moment later decide whether that
 * becomes a full interruption or the tutor simply carries on.
 *
 * Three things have to line up before a frame counts, and each one is a class of
 * false alarm that used to silence the tutor:
 *
 *   - it has to clear a threshold that rides the measured noise floor rather
 *     than a constant, because a quiet bedroom and a café differ by more than
 *     any single number can straddle;
 *   - the energy has to actually be in the voice band. A car, a passing lorry
 *     and a bump against the desk are loud underneath it; paper, keyboards and
 *     cutlery are loud above it. Both used to read as somebody speaking;
 *   - and it has to last. A voice is a continuous thing; a click, a tap and a
 *     door are over inside a frame or two.
 *
 * The last of those tolerates gaps rather than demanding a clean run, because
 * real speech has them — the closure inside a /p/ is 50ms of near silence, and
 * an unbroken run of loud frames is not what a spoken word looks like.
 */
export class VoiceActivityDetector {
  private noiseFloor = 0.01;
  private loudFrames = 0;
  private quietFrames = 0;
  private active = false;

  /*
   * The floor is the quietest the voice band has been over the last few seconds,
   * kept as the minimum of the current block and the one before it — so it looks
   * back somewhere between one and two blocks, without holding every frame.
   *
   * A minimum rather than an average, because an average of a sentence is mostly
   * the sentence. The room is what is left between the words, and there is
   * always a gap: the closure inside a consonant, a breath, the end of a clause.
   * That is what makes this safe to keep updating while somebody is talking —
   * and it means a fan switched on mid-session is learned within a few seconds
   * instead of slowly ducking the tutor for half a minute first.
   */
  private blockMinimum = Number.POSITIVE_INFINITY;
  private previousBlockMinimum = Number.POSITIVE_INFINITY;
  private blockFrames = 0;

  private readonly attackFrames: number;
  private readonly releaseFrames: number;
  private readonly absoluteThreshold: number;
  private readonly noiseMultiplier: number;
  private readonly rumbleTolerance: number;
  private readonly hissTolerance: number;
  private readonly floorWindowFrames: number;

  constructor(options: VoiceActivityOptions = {}) {
    this.attackFrames = options.attackFrames ?? 5;
    this.releaseFrames = options.releaseFrames ?? 24;
    this.absoluteThreshold = options.absoluteThreshold ?? 0.012;
    this.noiseMultiplier = options.noiseMultiplier ?? 2.6;
    this.floorWindowFrames = options.floorWindowFrames ?? 100;

    /*
     * Both tolerances are generous, because this detector is only responsible for
     * *speed*. Everything it turns down still reaches the recognizer, and a real
     * question still takes the floor a few hundred milliseconds later on the
     * strength of its words alone — so being strict here costs latency on a
     * barge-in, never the barge-in itself. A duck that should not have happened,
     * by contrast, is heard by the learner as the tutor stopping for no reason.
     *
     * A deep voice genuinely does put a lot of energy under 250 Hz — its
     * fundamental lives there — so the rumble test only rejects sound that is
     * *dominated* by the bottom end, the way traffic is.
     */
    this.rumbleTolerance = options.rumbleTolerance ?? 2;
    this.hissTolerance = options.hissTolerance ?? 1.2;
  }

  get isSpeaking() {
    return this.active;
  }

  get threshold() {
    return Math.max(this.absoluteThreshold, this.noiseFloor * this.noiseMultiplier);
  }

  /** Whether one frame is shaped like a voice rather than like the room around it. */
  private isVoiceShaped(frame: SpeechBandLevels) {
    return (
      frame.voice > this.threshold &&
      frame.rumble <= frame.voice * this.rumbleTolerance &&
      frame.hiss <= frame.voice * this.hissTolerance
    );
  }

  /** Feeds one frame's band levels in. Returns a transition, or null when nothing changed. */
  push(frame: SpeechBandLevels): "start" | "end" | null {
    const voiced = this.isVoiceShaped(frame);

    this.trackNoiseFloor(frame.voice);

    if (voiced) {
      // Capped: counting past the attack buys nothing, and a count left high by a
      // long sound would re-trigger the instant that sound finally ended.
      this.loudFrames = Math.min(this.attackFrames, this.loudFrames + 1);
      this.quietFrames = 0;
    } else {
      this.quietFrames += 1;

      /*
       * Decayed rather than cleared. Clearing would mean a single frame of
       * closure inside a word restarted the count and pushed the duck past the
       * point where it still feels like an answer; decaying still leaves a lone
       * click no way to reach the attack count on its own.
       */
      this.loudFrames = Math.max(0, this.loudFrames - 1);
    }

    if (!this.active && this.loudFrames >= this.attackFrames) {
      this.active = true;
      this.quietFrames = 0;

      return "start";
    }

    if (this.active && this.quietFrames >= this.releaseFrames) {
      this.active = false;
      this.loudFrames = 0;

      return "end";
    }

    return null;
  }

  private trackNoiseFloor(voice: number) {
    this.blockMinimum = Math.min(this.blockMinimum, voice);
    this.blockFrames += 1;

    if (this.blockFrames >= this.floorWindowFrames) {
      this.previousBlockMinimum = this.blockMinimum;
      this.blockMinimum = Number.POSITIVE_INFINITY;
      this.blockFrames = 0;
    }

    /*
     * Glided towards rather than snapped to, so the threshold does not step
     * every time a block turns over — a step there would land mid-word as often
     * as not.
     */
    const observed = Math.min(this.blockMinimum, this.previousBlockMinimum);
    this.noiseFloor += (observed - this.noiseFloor) * 0.05;
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
