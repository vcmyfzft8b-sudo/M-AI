/**
 * The line a voice says when you tap it to hear it.
 *
 * Keyed by the *note's* language rather than the interface's, because that is what the
 * tutor will actually speak: previewing a voice in English and then being taught in
 * Slovenian tells you nothing about the thing you were choosing. Soniox renders any of
 * its voices in any of its languages, so the same voice is worth hearing in the language
 * it will be used in — the accent and cadence differ.
 *
 * Kept out of the message catalogues for the same reason: those are indexed by the UI
 * locale, and this is not a UI string.
 */
const VOICE_SAMPLES: Record<string, string> = {
  sl: "Živjo, jaz sem tvoj tutor. Takole zvenim, ko ti razlagam snov.",
  en: "Hi, I'm your tutor. This is how I sound when I explain things to you.",
  hr: "Bok, ja sam tvoj tutor. Ovako zvučim dok ti objašnjavam gradivo.",
  bs: "Zdravo, ja sam tvoj tutor. Ovako zvučim dok ti objašnjavam gradivo.",
  sr: "Zdravo, ja sam tvoj tutor. Ovako zvučim dok ti objašnjavam gradivo.",
  de: "Hallo, ich bin dein Tutor. So klinge ich, wenn ich dir etwas erkläre.",
  it: "Ciao, sono il tuo tutor. Ecco come suono quando ti spiego le cose.",
};

/** Falls back to English for a language the app has no line for. */
export function voiceSampleText(language: string) {
  return VOICE_SAMPLES[language] ?? VOICE_SAMPLES.en;
}
