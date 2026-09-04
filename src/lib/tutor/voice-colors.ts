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

/**
 * The podcast's own reading of the same wheel, kept inside the tab's colour.
 *
 * The tutor spreads its voices right around the wheel, which is right there: one sphere at a
 * time, and the colour is the only thing telling you which voice you picked. The podcast puts
 * two of them side by side under a coral tab, and the default pair came out orange and green —
 * two spheres that plainly did not belong to the same show, or to the screen they were on.
 *
 * So the wheel is folded into a band around the podcast's own accent rather than replaced.
 * Every voice keeps its own colour and its place in the order; they just become shades of one
 * family — pink-coral through red and orange to amber — instead of eleven unrelated ones.
 *
 * Placed by RANK rather than by scaling the hue itself, because scaling inherits the gaps: the
 * tutor's hues cluster warm at the front by design, so scaling them put six voices into a third
 * of the band. Ranking spreads them evenly across it.
 *
 * The numbers are OKLCH angles, which is worth saying because the first attempt was not: these
 * are read straight into an oklch() in the stylesheet, and 330 there is magenta rather than the
 * pink it would be in HSL. The pair came out purple. In OKLCH the podcast's own accent sits at
 * 20, so the band runs from red through coral to amber around it, and Grace and Bennett — the
 * pair nobody changes — land twenty-one degrees apart: two clearly different spheres, obviously
 * of one material, obviously belonging to the tab they are under.
 */
const PODCAST_HUE_START = 0;
const PODCAST_HUE_SPAN = 70;

const PODCAST_HUE_ORDER = Object.entries(VOICE_HUES)
  .sort(([, a], [, b]) => a - b)
  .map(([voice]) => voice);

export function podcastVoiceHue(voice: string) {
  const rank = PODCAST_HUE_ORDER.indexOf(voice);
  const step = rank < 0 ? 0 : rank / Math.max(1, PODCAST_HUE_ORDER.length - 1);

  return (PODCAST_HUE_START + step * PODCAST_HUE_SPAN) % 360;
}
