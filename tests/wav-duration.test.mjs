import assert from "node:assert/strict";
import test from "node:test";

import { readWavDurationSeconds } from "../src/lib/wav-duration.ts";

/**
 * Builds a WAV header the way real encoders do, so the parser is tested against the layout it
 * will actually meet rather than one written to match it.
 */
function buildWav(options = {}) {
  const {
    channels = 1,
    sampleRate = 44_100,
    bitsPerSample = 16,
    seconds = 10,
    audioFormat = 1,
    declaredDataSize = null,
    extraChunk = null,
    actualDataBytes = null,
  } = options;

  const bytesPerSecond = (sampleRate * channels * bitsPerSample) / 8;
  const dataBytes = actualDataBytes ?? Math.round(bytesPerSecond * seconds);
  const fmtPayload = Buffer.alloc(16);
  fmtPayload.writeUInt16LE(audioFormat, 0);
  fmtPayload.writeUInt16LE(channels, 2);
  fmtPayload.writeUInt32LE(sampleRate, 4);
  fmtPayload.writeUInt32LE(bytesPerSecond, 8);
  fmtPayload.writeUInt16LE((channels * bitsPerSample) / 8, 12);
  fmtPayload.writeUInt16LE(bitsPerSample, 14);

  const chunks = [];
  const pushChunk = (id, payload) => {
    const header = Buffer.alloc(8);
    header.write(id, 0, 4, "ascii");
    header.writeUInt32LE(payload.length, 4);
    chunks.push(header, payload);

    if (payload.length % 2 === 1) {
      chunks.push(Buffer.alloc(1));
    }
  };

  pushChunk("fmt ", fmtPayload);

  if (extraChunk) {
    pushChunk(extraChunk.id, extraChunk.payload);
  }

  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0, 4, "ascii");
  dataHeader.writeUInt32LE(declaredDataSize ?? dataBytes, 4);
  chunks.push(dataHeader, Buffer.alloc(dataBytes));

  const body = Buffer.concat(chunks);
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, 4, "ascii");
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write("WAVE", 8, 4, "ascii");

  return new File([Buffer.concat([riff, body])], "lecture.wav", { type: "audio/wav" });
}

test("an ordinary 16-bit WAV reports its duration from the header", async () => {
  const duration = await readWavDurationSeconds(buildWav({ seconds: 42 }));

  assert.ok(duration != null);
  assert.ok(Math.abs(duration - 42) < 0.01, `got ${duration}`);
});

test("formats no browser will decode still report a duration", async () => {
  // This is the reported failure: 24-bit and float PCM exports are refused by Safari and Chrome,
  // so the <audio> element yields nothing and the header is the only source of truth left.
  const twentyFourBit = await readWavDurationSeconds(
    buildWav({ bitsPerSample: 24, seconds: 3_600, sampleRate: 48_000 }),
  );
  assert.ok(Math.abs(twentyFourBit - 3_600) < 0.5, `24-bit: ${twentyFourBit}`);

  // WAVE_FORMAT_EXTENSIBLE (0xFFFE) and IEEE float (3) keep the same fmt layout.
  const extensible = await readWavDurationSeconds(
    buildWav({ audioFormat: 0xfffe, bitsPerSample: 32, seconds: 120 }),
  );
  assert.ok(Math.abs(extensible - 120) < 0.05, `extensible: ${extensible}`);

  const float = await readWavDurationSeconds(buildWav({ audioFormat: 3, bitsPerSample: 32 }));
  assert.ok(Math.abs(float - 10) < 0.05, `float: ${float}`);
});

test("a metadata chunk before the audio does not hide the duration", async () => {
  // Recorders and DAWs write LIST/INFO blocks between `fmt ` and `data`; walking chunk by chunk
  // is what keeps those from being read as audio.
  const duration = await readWavDurationSeconds(
    buildWav({
      seconds: 90,
      extraChunk: { id: "LIST", payload: Buffer.alloc(2_048, 0x20) },
    }),
  );

  assert.ok(Math.abs(duration - 90) < 0.05, `got ${duration}`);
});

test("an odd-sized chunk keeps its pad byte from shifting everything after it", async () => {
  const duration = await readWavDurationSeconds(
    buildWav({
      seconds: 30,
      extraChunk: { id: "bext", payload: Buffer.alloc(101, 0x41) },
    }),
  );

  assert.ok(Math.abs(duration - 30) < 0.05, `got ${duration}`);
});

test("a recording cut short is measured by what it holds, not what it claims", async () => {
  // A file whose writer died mid-take still declares the size it intended to reach; trusting it
  // would report a duration far longer than the audio and could trip the three-hour limit.
  const duration = await readWavDurationSeconds(
    buildWav({ seconds: 5, declaredDataSize: 0xffffffff }),
  );

  assert.ok(duration != null);
  assert.ok(Math.abs(duration - 5) < 0.05, `got ${duration}`);
});

test("anything that is not a WAV is declined rather than guessed at", async () => {
  const mp3 = new File([Buffer.alloc(4_096, 0x49)], "lecture.mp3", { type: "audio/mpeg" });
  assert.equal(await readWavDurationSeconds(mp3), null);

  const truncated = new File([Buffer.from("RIFF")], "broken.wav", { type: "audio/wav" });
  assert.equal(await readWavDurationSeconds(truncated), null);
});

test("a one-hour uncompressed lecture is measured, and is nowhere near the limits", async () => {
  // The file from the report: an hour of 16-bit 22 kHz mono is ~100 MB, and used to be refused
  // outright. It is well inside both caps once something can actually read it.
  const file = buildWav({ sampleRate: 22_050, bitsPerSample: 16, channels: 1, seconds: 3_600 });
  const duration = await readWavDurationSeconds(file);

  assert.ok(Math.abs(duration - 3_600) < 0.5, `got ${duration}`);
  assert.ok(file.size > 90 * 1024 * 1024, `expected ~100MB, got ${file.size}`);
  assert.ok(duration < 3 * 60 * 60, "inside the three-hour cap");
});
