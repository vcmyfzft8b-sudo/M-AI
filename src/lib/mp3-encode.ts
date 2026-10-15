import { Mp3Encoder } from "@breezystack/lamejs";

/**
 * Bare 16-bit mono PCM as constant-bitrate MP3, which is what read-aloud and the podcast store.
 *
 * Encoded here because Gemini answers only in PCM and a Vercel function has no ffmpeg. A minute of
 * speech is about 2.9 MB raw and 480 KB at 64 kbps, and every player in the app already plays this
 * format — Safari included, which is why it is MP3 rather than Opus.
 *
 * The encoder hands back `Int8Array` frames whatever its type file says, and `Buffer.concat`
 * refuses those, so each frame is re-viewed as bytes before it is joined. That mismatch failed
 * every read-aloud chunk the first time this ran (tests/mp3-encode.test.mjs).
 */
export function encodeMp3(pcm: Uint8Array, sampleRate: number, bitrate: number) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const encoder = new Mp3Encoder(1, sampleRate, Math.round(bitrate / 1000));
  const frames: Uint8Array[] = [];
  const asBytes = (frame: ArrayLike<number> & ArrayBufferView) =>
    new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
  const block = 1152 * 16;

  for (let offset = 0; offset < samples.length; offset += block) {
    const frame = encoder.encodeBuffer(samples.subarray(offset, offset + block));

    if (frame.length > 0) {
      frames.push(asBytes(frame));
    }
  }

  const tail = encoder.flush();

  if (tail.length > 0) {
    frames.push(asBytes(tail));
  }

  const out = new Uint8Array(frames.reduce((sum, frame) => sum + frame.byteLength, 0));
  let at = 0;

  for (const frame of frames) {
    out.set(frame, at);
    at += frame.byteLength;
  }

  return out;
}
