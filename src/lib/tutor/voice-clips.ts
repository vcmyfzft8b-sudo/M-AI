// Relative, not aliased: which languages have files on disk and which are synthesized on demand
// decides whether a picker costs eleven paid calls, and that is worth a test rather than a read.
import { NOTE_LANGUAGE_OPTIONS } from "../languages.ts";

/**
 * Where the pre-rendered voice clips live.
 *
 * Three per voice per language, written by `scripts/generate-tutor-voice-clips.mjs`
 * into `public/tutor-demo`. The sample is the line the app auditions a voice with;
 * the other two are the marketing demo's exchange — what the tutor is saying when
 * the learner cuts in, and what it says in answer — and exist only for the
 * languages that page is served in.
 */

const SAMPLE_LANGUAGES = new Set<string>(NOTE_LANGUAGE_OPTIONS.map((option) => option.value));

/* The landing page's own locales. German and Italian are note languages, not page ones. */
const BED_LANGUAGES = new Set(["sl", "en", "hr", "bs", "sr"]);

function clip(language: string, voice: string, kind: "sample" | "tutor" | "answer") {
  return `/tutor-demo/${language}/${voice.toLowerCase()}-${kind}.mp3`;
}

/**
 * Whether this language has clips on disk.
 *
 * The seven the app has note furniture for do; a learner's material can be in any language
 * Soniox speaks, and those are synthesized on demand instead — see the voice-sample route. It is
 * exported because the caller has to know: pre-rendered files are free to fetch eleven at a time
 * and synthesized ones are not.
 */
export function hasStaticVoiceSamples(language: string) {
  return SAMPLE_LANGUAGES.has(language);
}

/** The audition line, in the language the tutor will actually speak. */
export function voiceSampleClip(voice: string, language: string) {
  /*
   * Falling back to the English clip was the old behaviour and it auditioned the wrong thing: the
   * accent and cadence of a voice are exactly what differ between languages, so hearing Grace in
   * English tells a Polish learner nothing about the Grace that is going to teach them.
   */
  return hasStaticVoiceSamples(language)
    ? clip(language, voice, "sample")
    : `/api/tutor/voice-sample?voice=${encodeURIComponent(voice)}&language=${encodeURIComponent(language)}`;
}

/** The demo's opening: the tutor starting to explain. */
export function tutorDemoClip(voice: string, language: string) {
  return clip(BED_LANGUAGES.has(language) ? language : "en", voice, "tutor");
}

/**
 * What it says when the learner cuts in. Answers `tutorDemo.heard1` in the message
 * catalogues, which is the question the page prints — the two are written together
 * and only make sense together.
 */
export function tutorAnswerClip(voice: string, language: string) {
  return clip(BED_LANGUAGES.has(language) ? language : "en", voice, "answer");
}
