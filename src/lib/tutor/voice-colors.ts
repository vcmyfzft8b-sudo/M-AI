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
 * The podcast's own reading of the same wheel: indigo on the left, pink on the right.
 *
 * The tutor spreads its voices right around the wheel, which is right there — one sphere at a
 * time, and the colour is the only thing telling you which voice you picked. The podcast shows
 * two at once, so a spread has a second job the tutor's never had: whichever two voices are
 * chosen have to look like a pair.
 *
 * A band alone does not do that. Centred on the podcast tab's own coral it produced two spheres
 * of nearly the same colour, and widened enough to separate them it wandered into the orange the
 * tutor tab uses and the pink the quiz does. Every hue in this app already belongs to some tab.
 *
 * So the band is split rather than shared. Host A lives in the indigo half and host B in the
 * pink, and the voice chosen moves that host WITHIN its own half — the choice still shows, the
 * two hosts can never converge, and any pair reads as one indigo-to-pink object rather than two
 * balls that happen to be near each other. A solo episode gets the indigo half, which is where
 * its single sphere has always sat.
 *
 * The numbers are OKLCH angles, which is worth saying because the first attempt was not: these
 * are read straight into an oklch() in the stylesheet, and 330 there is magenta rather than the
 * pink it would be in HSL. The pair came out purple.
 */
const PODCAST_HUE_HALVES = {
  a: { start: 265, span: 35 },
  b: { start: 315, span: 35 },
} as const;

const PODCAST_HUE_ORDER = Object.entries(VOICE_HUES)
  .sort(([, a], [, b]) => a - b)
  .map(([voice]) => voice);

export function podcastVoiceHue(voice: string, speaker: "a" | "b" = "a") {
  const rank = PODCAST_HUE_ORDER.indexOf(voice);
  const step = rank < 0 ? 0 : rank / Math.max(1, PODCAST_HUE_ORDER.length - 1);
  const half = PODCAST_HUE_HALVES[speaker];

  return (half.start + step * half.span) % 360;
}
