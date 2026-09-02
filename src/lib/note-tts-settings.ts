// The voices Soniox ships on tts-rt-v2. Five carried over from v1 unchanged; the other three were
// dropped with v1, so the closest v2 voice stands in for each — see LEGACY_NOTE_TTS_VOICE_ALIASES.
// The last three are new with v2 and picked for study notes: Bennett (the calm authority of an
// experienced teacher), Evan (makes detailed information easy to follow), Iris (clear and patient).
export const NOTE_TTS_VOICES = [
  "Grace",
  "Mina",
  "Emma",
  "Sloane",
  "Nina",
  "Daniel",
  "Adrian",
  "Freddie",
  "Bennett",
  "Evan",
  "Iris",
] as const;

export type NoteTtsVoice = (typeof NOTE_TTS_VOICES)[number];

export const DEFAULT_NOTE_TTS_VOICE: NoteTtsVoice = "Grace";

// Voices tts-rt-v1 had and tts-rt-v2 does not. They survive in three places — a reader's saved
// setting, a note's creation metadata, and the request body an older bundle still sends — so every
// one of those reads goes through normalizeNoteTtsVoice rather than the list above.
export const LEGACY_NOTE_TTS_VOICE_ALIASES = {
  Maya: "Mina",
  Claire: "Sloane",
  Noah: "Freddie",
} as const satisfies Record<string, NoteTtsVoice>;

export type LegacyNoteTtsVoice = keyof typeof LEGACY_NOTE_TTS_VOICE_ALIASES;

export const NOTE_TTS_VOICE_INPUTS = [
  ...NOTE_TTS_VOICES,
  ...(Object.keys(LEGACY_NOTE_TTS_VOICE_ALIASES) as LegacyNoteTtsVoice[]),
] as const;

function isLegacyNoteTtsVoice(value: string): value is LegacyNoteTtsVoice {
  return Object.prototype.hasOwnProperty.call(LEGACY_NOTE_TTS_VOICE_ALIASES, value);
}

export function normalizeNoteTtsVoice(value: unknown): NoteTtsVoice {
  if (typeof value !== "string") {
    return DEFAULT_NOTE_TTS_VOICE;
  }

  const current = NOTE_TTS_VOICES.find((voice) => voice === value);

  if (current) {
    return current;
  }

  return isLegacyNoteTtsVoice(value) ? LEGACY_NOTE_TTS_VOICE_ALIASES[value] : DEFAULT_NOTE_TTS_VOICE;
}

export const NOTE_TTS_VOICE_STORAGE_KEY = "memo-note-tts-voice";

export const NOTE_TTS_PLAYBACK_RATES = [0.5, 1, 1.5, 2] as const;

export type NoteTtsPlaybackRate = (typeof NOTE_TTS_PLAYBACK_RATES)[number];

export const DEFAULT_NOTE_TTS_PLAYBACK_RATE: NoteTtsPlaybackRate = 1;

import type { MessageKey } from "@/lib/i18n/messages/keys";

export const NOTE_TTS_HIGHLIGHT_COLORS = [
  {
    id: "orange",
    labelKey: "color.orange",
    readBackground: "#ffedd5",
    readColor: "#7c2d12",
    currentBackground: "#fb923c",
    currentColor: "#431407",
    currentRing: "rgba(251, 146, 60, 0.28)",
    darkReadBackground: "rgba(251, 146, 60, 0.22)",
    darkReadColor: "#fed7aa",
    darkCurrentBackground: "#c2410c",
    darkCurrentColor: "#fff7ed",
    darkCurrentRing: "rgba(251, 146, 60, 0.36)",
  },
  {
    id: "yellow",
    labelKey: "color.yellow",
    readBackground: "#fef3c7",
    readColor: "#78350f",
    currentBackground: "#facc15",
    currentColor: "#422006",
    currentRing: "rgba(250, 204, 21, 0.32)",
    darkReadBackground: "rgba(250, 204, 21, 0.22)",
    darkReadColor: "#fde68a",
    darkCurrentBackground: "#ca8a04",
    darkCurrentColor: "#fffbeb",
    darkCurrentRing: "rgba(250, 204, 21, 0.38)",
  },
  {
    id: "green",
    labelKey: "color.green",
    readBackground: "#dcfce7",
    readColor: "#14532d",
    currentBackground: "#4ade80",
    currentColor: "#052e16",
    currentRing: "rgba(74, 222, 128, 0.28)",
    darkReadBackground: "rgba(74, 222, 128, 0.2)",
    darkReadColor: "#bbf7d0",
    darkCurrentBackground: "#15803d",
    darkCurrentColor: "#f0fdf4",
    darkCurrentRing: "rgba(74, 222, 128, 0.34)",
  },
  {
    id: "blue",
    labelKey: "color.blue",
    readBackground: "#dbeafe",
    readColor: "#1e3a8a",
    currentBackground: "#60a5fa",
    currentColor: "#0f172a",
    currentRing: "rgba(96, 165, 250, 0.3)",
    darkReadBackground: "rgba(96, 165, 250, 0.22)",
    darkReadColor: "#bfdbfe",
    darkCurrentBackground: "#2563eb",
    darkCurrentColor: "#eff6ff",
    darkCurrentRing: "rgba(96, 165, 250, 0.36)",
  },
  {
    id: "pink",
    labelKey: "color.pink",
    readBackground: "#fce7f3",
    readColor: "#831843",
    currentBackground: "#f472b6",
    currentColor: "#500724",
    currentRing: "rgba(244, 114, 182, 0.3)",
    darkReadBackground: "rgba(244, 114, 182, 0.22)",
    darkReadColor: "#fbcfe8",
    darkCurrentBackground: "#be185d",
    darkCurrentColor: "#fdf2f8",
    darkCurrentRing: "rgba(244, 114, 182, 0.36)",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  labelKey: MessageKey;
  readBackground: string;
  readColor: string;
  currentBackground: string;
  currentColor: string;
  currentRing: string;
  darkReadBackground: string;
  darkReadColor: string;
  darkCurrentBackground: string;
  darkCurrentColor: string;
  darkCurrentRing: string;
}>;

export type NoteTtsHighlightColorId = (typeof NOTE_TTS_HIGHLIGHT_COLORS)[number]["id"];

export const DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID: NoteTtsHighlightColorId = "orange";
