// The shape of an episode, shared by the screen that offers it and the server that writes it.
// Kept free of "server-only" for that reason, and free of anything that needs a request.
//
// The voice import is relative rather than aliased so tests/podcast-script.test.mjs can load this
// module directly, the way the note's own TTS settings are loaded — Node cannot resolve "@/".

import type { MessageKey } from "@/lib/i18n/messages/keys";
import {
  DEFAULT_NOTE_TTS_VOICE,
  NOTE_TTS_VOICES,
  normalizeNoteTtsVoice,
  type NoteTtsVoice,
} from "./note-tts-settings.ts";

/**
 * The four shows.
 *
 * Three of them are two-handers and one is not, which is the only structural difference between
 * them — everything else is a difference in what the two people are doing with each other, and
 * that lives in the prompt (podcast-prompt.ts). They are offered as shows rather than as a set of
 * toggles because "two voices, disagreeing, ten minutes" is not a thing anybody wants to assemble
 * out of parts; it is a thing they want to press.
 *
 * `deepDive` is the default and the one to reach for if only one ever ships: a host asking the
 * questions a learner would and a guide answering them is the format that turns a set of notes
 * into something a person can follow without a page in front of them.
 */
export const PODCAST_FORMATS = [
  {
    id: "deep_dive",
    speakerCount: 2,
    labelKey: "podcast.format.deepDive",
    descriptionKey: "podcast.format.deepDive.description",
    icon: "podcasts",
  },
  {
    id: "debate",
    speakerCount: 2,
    labelKey: "podcast.format.debate",
    descriptionKey: "podcast.format.debate.description",
    icon: "balance",
  },
  {
    id: "interview",
    speakerCount: 2,
    labelKey: "podcast.format.interview",
    descriptionKey: "podcast.format.interview.description",
    icon: "record_voice_over",
  },
  {
    id: "solo",
    speakerCount: 1,
    labelKey: "podcast.format.solo",
    descriptionKey: "podcast.format.solo.description",
    icon: "mic",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  speakerCount: 1 | 2;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  icon: string;
}>;

export type PodcastFormat = (typeof PODCAST_FORMATS)[number]["id"];

export const DEFAULT_PODCAST_FORMAT: PodcastFormat = "deep_dive";

export const PODCAST_FORMAT_IDS = PODCAST_FORMATS.map((format) => format.id) as [
  PodcastFormat,
  ...PodcastFormat[],
];

export function getPodcastFormat(id: PodcastFormat) {
  return PODCAST_FORMATS.find((format) => format.id === id) ?? PODCAST_FORMATS[0];
}

export function normalizePodcastFormat(value: unknown): PodcastFormat {
  return PODCAST_FORMATS.find((format) => format.id === value)?.id ?? DEFAULT_PODCAST_FORMAT;
}

/**
 * How long an episode runs, expressed in words rather than minutes.
 *
 * Words are what the model can actually be asked for, and minutes are what a listener chooses in,
 * so the pair are kept together here and converted in one place — see PODCAST_WORDS_PER_SECOND
 * for the rate, which is measured on episodes rather than borrowed.
 */
export const PODCAST_LENGTHS = [
  { id: "brief", targetWords: 500, labelKey: "podcast.length.brief" },
  { id: "standard", targetWords: 920, labelKey: "podcast.length.standard" },
  { id: "deep", targetWords: 1_450, labelKey: "podcast.length.deep" },
] as const satisfies ReadonlyArray<{
  id: string;
  targetWords: number;
  labelKey: MessageKey;
}>;

export type PodcastLength = (typeof PODCAST_LENGTHS)[number]["id"];

export const DEFAULT_PODCAST_LENGTH: PodcastLength = "standard";

export const PODCAST_LENGTH_IDS = PODCAST_LENGTHS.map((length) => length.id) as [
  PodcastLength,
  ...PodcastLength[],
];

export function getPodcastLength(id: PodcastLength) {
  return PODCAST_LENGTHS.find((length) => length.id === id) ?? PODCAST_LENGTHS[1];
}

export function normalizePodcastLength(value: unknown): PodcastLength {
  return PODCAST_LENGTHS.find((length) => length.id === value)?.id ?? DEFAULT_PODCAST_LENGTH;
}

/**
 * How fast a host actually talks, and the only place minutes and words are converted.
 *
 * Measured on episodes rather than borrowed from read-aloud, and the difference mattered.
 * Read-aloud's 1.6-1.9 words a second is a rate over notes, which carry formulas, headings and
 * lists that are read slowly or spelled out; a podcast is unbroken prose, and prose runs faster.
 * Twelve turns of the omrezja-sl rehearsal, both voices, Slovenian:
 *
 *   423 words → 201.9s of audio = 2.10 words/second (per turn: 1.72 to 2.50)
 *
 * At the borrowed 1.7 the buttons promised nine minutes and delivered seven — an episode a third
 * shorter than the one somebody chose. Re-measure this if the voices or the model change; the
 * labels are computed from it, so nothing else needs touching when it moves.
 */
export const PODCAST_WORDS_PER_SECOND = 2.1;

/**
 * The rate the daily allowance is held against before a word has been synthesized.
 *
 * Deliberately the slow end of the measured spread rather than its middle. A reservation is
 * corrected to what the audio actually came to as soon as it exists, so reserving too much costs
 * a listener nothing; reserving too little lets a run of slow turns settle past the daily cap
 * after the fact. The two directions are not symmetrical, so they do not share a constant.
 */
export const PODCAST_RESERVED_WORDS_PER_SECOND = 1.75;

export function estimatedPodcastMinutes(length: PodcastLength) {
  return Math.max(1, Math.round(getPodcastLength(length).targetWords / PODCAST_WORDS_PER_SECOND / 60));
}

function countSpokenWords(text: string) {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

/** What a turn is expected to run to, for the parts of the episode not yet made. */
export function estimatedSpokenSeconds(text: string) {
  return Math.max(1, Math.ceil(countSpokenWords(text) / PODCAST_WORDS_PER_SECOND));
}

/** What to hold against the allowance before synthesizing a turn. */
export function reservedSpokenSeconds(text: string) {
  return Math.max(1, Math.ceil(countSpokenWords(text) / PODCAST_RESERVED_WORDS_PER_SECOND));
}

export type PodcastSpeaker = "a" | "b";

export const PODCAST_SPEAKERS: PodcastSpeaker[] = ["a", "b"];

export type PodcastTurn = {
  speaker: PodcastSpeaker;
  text: string;
};

/**
 * The two voices, and why the second one is not simply "any other voice".
 *
 * Two hosts who sound alike is the one failure this screen can ship that nobody notices until
 * they are listening — the episode becomes one person talking to themselves. So the default pair
 * is picked to sit at opposite ends of the voice list, and choosing a voice for one host pushes
 * the other away from it rather than letting both settle on the same name.
 */
export const DEFAULT_PODCAST_VOICES: Record<PodcastSpeaker, NoteTtsVoice> = {
  a: "Grace",
  b: "Bennett",
};

export function normalizePodcastVoice(value: unknown, speaker: PodcastSpeaker): NoteTtsVoice {
  if (typeof value !== "string") {
    return DEFAULT_PODCAST_VOICES[speaker];
  }

  return normalizeNoteTtsVoice(value);
}

/** The voice to move a host to when the other host has just taken theirs. */
export function displacedPodcastVoice(taken: NoteTtsVoice): NoteTtsVoice {
  const index = NOTE_TTS_VOICES.indexOf(taken);

  if (index < 0) {
    return DEFAULT_NOTE_TTS_VOICE;
  }

  /* Halfway round the list: as far from the taken voice as the list allows, deterministically. */
  return NOTE_TTS_VOICES[(index + Math.floor(NOTE_TTS_VOICES.length / 2)) % NOTE_TTS_VOICES.length];
}

/**
 * How many turns a listener may have in synthesis at once.
 *
 * Soniox caps concurrent TTS streams for the WHOLE ORGANIZATION, and this feature shares that cap
 * with read-aloud and with the voice tutor — which is speaking to somebody in real time and
 * cannot wait its turn. So this is not a client-side nicety; it decides how many people can
 * listen at once, which is why it lives here beside the rates it is derived from and is tested
 * rather than left inline in the player.
 *
 * One stream is enough to stay ahead, and that is measured: synthesis runs at about 0.81x the
 * length of the audio it produces, so one stream makes roughly 1.25 seconds of audio per second
 * while a listener at 1x consumes one. It stops being enough in exactly two situations, and the
 * second stream is taken only in those:
 *
 *   - nothing is buffered yet, at the start or after a seek, where the wait is in front of them;
 *   - playback is faster than 1x, where consumption outruns a single stream outright.
 */
export const SEGMENT_REQUESTS_WHILE_BUFFERED = 1;
export const SEGMENT_REQUESTS_WHILE_CATCHING_UP = 2;

/** Turns ready ahead of the one playing, past which one stream is keeping up comfortably. */
export const COMFORTABLE_BUFFER_TURNS = 2;

export function segmentRequestAllowance(params: { bufferedAhead: number; rate: number }) {
  return params.bufferedAhead >= COMFORTABLE_BUFFER_TURNS && params.rate <= 1
    ? SEGMENT_REQUESTS_WHILE_BUFFERED
    : SEGMENT_REQUESTS_WHILE_CATCHING_UP;
}

export type VoiceGender = "f" | "m";

/**
 * Which voice sounds like a woman and which like a man.
 *
 * Needed because the languages this app is used in inflect for it. In Slovenian, Croatian,
 * Serbian and Bosnian a past-tense verb, a participle and an adjective all agree with the gender
 * of whoever they are about — so one host saying "kot si rekel" to a woman is not a stylistic
 * slip, it is wrong, and it is wrong in every second sentence of a conversation between two
 * people. English never notices; these languages notice immediately.
 *
 * Three of these are evidence rather than inference: tts-rt-v1's Claire, Maya and Noah were
 * retired onto Sloane, Mina and Freddie (LEGACY_NOTE_TTS_VOICE_ALIASES), which fixes those three
 * as female, female and male. The rest follow their names, which is how the provider presents
 * them. If a voice is ever heard to disagree with this table, the table is what is wrong.
 */
const VOICE_GENDERS: Record<NoteTtsVoice, VoiceGender> = {
  Grace: "f",
  Mina: "f",
  Emma: "f",
  Sloane: "f",
  Nina: "f",
  Iris: "f",
  Daniel: "m",
  Adrian: "m",
  Freddie: "m",
  Bennett: "m",
  Evan: "m",
};

export function voiceGender(voice: string): VoiceGender {
  return VOICE_GENDERS[voice as NoteTtsVoice] ?? VOICE_GENDERS[DEFAULT_NOTE_TTS_VOICE];
}

/**
 * The part of the cast a SCRIPT depends on.
 *
 * Not the voices themselves — swapping Grace for Emma changes nothing a writer would write, and
 * making it change the script would throw away an episode for no reason. What the writer has to
 * know is the genders, because the words it chooses agree with them.
 */
export function podcastCastKey(params: {
  voices: Record<PodcastSpeaker, NoteTtsVoice>;
  speakerCount: 1 | 2;
}) {
  return params.speakerCount === 1
    ? voiceGender(params.voices.a)
    : `${voiceGender(params.voices.a)}${voiceGender(params.voices.b)}`;
}

export const PODCAST_FORMAT_STORAGE_KEY = "memo-podcast-format";
export const PODCAST_LENGTH_STORAGE_KEY = "memo-podcast-length";
export const PODCAST_VOICE_A_STORAGE_KEY = "memo-podcast-voice-a";
export const PODCAST_VOICE_B_STORAGE_KEY = "memo-podcast-voice-b";

/**
 * A spoken turn's ceiling, in words.
 *
 * Soniox stops a request at three minutes of audio and truncates the rest silently, so a turn has
 * to be a request it cannot reach. At the measured rate this is a little over two minutes, and
 * the prompt asks for turns a third of that — this is the guard, not the plan.
 */
export const PODCAST_MAX_TURN_WORDS = 220;

/**
 * What one turn is meant to weigh, and the second half of how an episode's length is asked for.
 *
 * A word count alone does not determine an episode: the same 900 words is fifteen brisk
 * exchanges or thirty short ones, and asked for only in words the writer reliably chooses the
 * short ones and comes in under. Giving it a per-turn size as well is what makes the minutes on
 * the button honest — see lengthRules in podcast-prompt.ts for the measurement.
 */
export const PODCAST_TARGET_TURN_WORDS = 45;

/**
 * A turn's floor, and the reason the transcript does not read like a chat log.
 *
 * Each turn is one Soniox request and one `<audio>` element, so a script made of "Right." and
 * "Exactly." is a script that costs a request per syllable and plays with a gap between every
 * one of them. The prompt asks for reactions to be spoken as the opening of the next real
 * contribution instead — which is also how people actually talk on a podcast.
 */
export const PODCAST_MIN_TURN_WORDS = 12;
