import assert from "node:assert/strict";
import test from "node:test";

import { encodeMp3 } from "../src/lib/mp3-encode.ts";

// Read-aloud and the podcast store Gemini's PCM as MP3. The first real run failed every chunk
// because the encoder returns Int8Array frames, so this encodes actual audio end to end.

function tone(seconds, sampleRate = 24_000) {
  const samples = new Int16Array(Math.round(seconds * sampleRate));

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.round(8_000 * Math.sin((2 * Math.PI * 220 * index) / sampleRate));
  }

  return new Uint8Array(samples.buffer);
}

test("a second of 24 kHz speech becomes a playable MP3 of the right size", () => {
  const mp3 = encodeMp3(tone(1), 24_000, 64_000);

  assert.ok(mp3 instanceof Uint8Array);
  // MPEG-2 Layer III frame sync: 0xFFF, version bits for 24 kHz.
  assert.equal(mp3[0], 0xff);
  assert.equal(mp3[1] & 0xe0, 0xe0);
  // 64 kbps for one second is 8 KB; allow for the final partial frame.
  assert.ok(mp3.length > 7_000 && mp3.length < 9_500, String(mp3.length));
  assert.ok(Buffer.concat([mp3]).length === mp3.length, "joins with Buffer.concat like the callers do");
});

test("an odd trailing byte and a view into a larger buffer are both handled", () => {
  const pcm = tone(0.5);
  const padded = new Uint8Array(pcm.length + 3);
  padded.set(pcm, 2);

  const mp3 = encodeMp3(padded.subarray(2, 2 + pcm.length + 1), 24_000, 64_000);

  assert.ok(mp3.length > 3_000);
});
