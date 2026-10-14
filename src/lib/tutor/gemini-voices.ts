// Relative import: scripts/generate-tutor-voice-clips.mjs reads this outside Next.
import type { NoteTtsVoice } from "../note-tts-settings.ts";

/**
 * Which Gemini voice speaks for each of the tutor's eleven.
 *
 * The picker keeps its names, colours and stored choice; only the sound behind each name changed
 * when the tutor moved to Gemini (2026-10-14). Each was matched on gender — measured, by median
 * pitch over a Slovenian and a Croatian line, because the list Google publishes does not say and
 * one of its "female" voices (Pulcherrima) sits at 126 Hz — and on the character each name was
 * picked for. Kore and Schedar won the blind test on Slovenian, so they take the default and its
 * nearest male counterpart.
 *
 * Read-aloud and the podcast still speak with Soniox, so the same name sounds different there.
 */
export const GEMINI_TUTOR_VOICES: Record<NoteTtsVoice, string> = {
  Grace: "Kore",
  Mina: "Sulafat",
  Emma: "Aoede",
  Sloane: "Laomedeia",
  Nina: "Leda",
  Iris: "Erinome",
  Daniel: "Schedar",
  Adrian: "Achird",
  Freddie: "Sadachbia",
  Bennett: "Charon",
  Evan: "Iapetus",
};

export function geminiVoiceFor(voice: NoteTtsVoice) {
  return GEMINI_TUTOR_VOICES[voice] ?? GEMINI_TUTOR_VOICES.Grace;
}
