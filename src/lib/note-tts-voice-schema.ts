import { z } from "zod";

import { NOTE_TTS_VOICE_INPUTS, normalizeNoteTtsVoice } from "@/lib/note-tts-settings";

// Accepts the current voices and the ones tts-rt-v1 had, and always yields a current one. A bundle
// cached from before the v2 switch still sends "Maya"; rejecting it would 400 every read-aloud
// request from that tab until it reloaded.
export const noteTtsVoiceSchema = z.enum(NOTE_TTS_VOICE_INPUTS).transform(normalizeNoteTtsVoice);
