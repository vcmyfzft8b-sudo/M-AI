import { NOTE_LANGUAGE_OPTIONS } from "@/lib/languages";

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

/** The audition line, in the language the tutor will actually speak. */
export function voiceSampleClip(voice: string, language: string) {
  return clip(SAMPLE_LANGUAGES.has(language) ? language : "en", voice, "sample");
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
