import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_NOTE_TTS_VOICE,
  LEGACY_NOTE_TTS_VOICE_ALIASES,
  NOTE_TTS_VOICE_INPUTS,
  NOTE_TTS_VOICES,
  normalizeNoteTtsVoice,
} from "../src/lib/note-tts-settings.ts";

// The reader's saved voice, a note's creation metadata and an older bundle's request body can all
// still name a voice that only tts-rt-v1 had. Each must land on its v2 stand-in, never on a 400.
test("maps every voice tts-rt-v1 had to a voice tts-rt-v2 has", () => {
  for (const [legacy, replacement] of Object.entries(LEGACY_NOTE_TTS_VOICE_ALIASES)) {
    assert.equal(normalizeNoteTtsVoice(legacy), replacement);
    assert.ok(NOTE_TTS_VOICES.includes(replacement), `${replacement} is not a current voice`);
    assert.ok(!NOTE_TTS_VOICES.includes(legacy), `${legacy} is both legacy and current`);
  }
});

test("keeps a current voice as it is", () => {
  for (const voice of NOTE_TTS_VOICES) {
    assert.equal(normalizeNoteTtsVoice(voice), voice);
  }
});

test("falls back to the default for anything else", () => {
  assert.equal(normalizeNoteTtsVoice("Zeus"), DEFAULT_NOTE_TTS_VOICE);
  assert.equal(normalizeNoteTtsVoice(""), DEFAULT_NOTE_TTS_VOICE);
  assert.equal(normalizeNoteTtsVoice(null), DEFAULT_NOTE_TTS_VOICE);
  assert.equal(normalizeNoteTtsVoice(undefined), DEFAULT_NOTE_TTS_VOICE);
  assert.equal(normalizeNoteTtsVoice("toString"), DEFAULT_NOTE_TTS_VOICE);
});

test("the request schema input set is the current voices plus the legacy ones", () => {
  const expected = new Set([...NOTE_TTS_VOICES, ...Object.keys(LEGACY_NOTE_TTS_VOICE_ALIASES)]);
  assert.deepEqual(new Set(NOTE_TTS_VOICE_INPUTS), expected);
  assert.equal(NOTE_TTS_VOICE_INPUTS.length, expected.size);
});
