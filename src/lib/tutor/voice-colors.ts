import { NOTE_TTS_VOICES, type NoteTtsVoice } from "@/lib/note-tts-settings";

/**
 * A hue per voice, so the sphere looks like the voice you picked.
 *
 * Choosing a voice is otherwise a decision you make once and then cannot see — the label
 * scrolls out of the row and every voice drives the same orange ball. Giving each one a
 * colour makes the choice visible for the whole session and makes previewing feel like
 * trying things on rather than reading a list.
 *
 * Spread around the wheel but kept at one lightness and chroma by the stylesheet, so
 * eleven voices read as eleven colours of the same material rather than eleven different
 * materials. Warm hues sit near the front because the default has always been warm and a
 * learner who never touches the row should see the sphere they have always seen.
 */
const VOICE_HUES: Record<NoteTtsVoice, number> = {
  Grace: 45,
  Mina: 25,
  Emma: 340,
  Sloane: 300,
  Nina: 265,
  Daniel: 230,
  Adrian: 200,
  Freddie: 170,
  Bennett: 140,
  Evan: 100,
  Iris: 70,
};

/** Falls back to the default voice's hue for anything unrecognised. */
export function voiceHue(voice: string) {
  return VOICE_HUES[voice as NoteTtsVoice] ?? VOICE_HUES[NOTE_TTS_VOICES[0]];
}
