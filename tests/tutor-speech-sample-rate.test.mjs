import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIO_FRAME,
  FakeAudioContext,
  installGlobals,
  loadSpeechOutput,
  settle,
} from "./tutor-speech-harness.mjs";

const { TutorSpeechOutput } = await loadSpeechOutput();
const config = { url: "wss://synthetic.invalid", apiKey: "test", model: "tts-rt-v2", voice: "Grace", language: "sl" };

/** A device whose audio route puts the context at a rate Soniox does not generate. */
const contextRunningAt = (rate) => {
  class RateContext extends FakeAudioContext {
    sampleRate = rate;
  }

  globalThis.window.AudioContext = RateContext;
};

const announcedRate = async (deviceRate) => {
  const sockets = installGlobals();
  contextRunningAt(deviceRate);
  const output = new TutorSpeechOutput(config);
  await output.connect();
  const turn = output.speak();
  turn.push("Danes govorimo o celici. ");
  await settle();
  const start = sockets[0].sent.find((frame) => frame.api_key);
  output.close();

  return { rate: start.sample_rate, output, turn };
};

test("a device at an unsupported rate is not asked for one Soniox refuses", async () => {
  /*
   * MEMOAI-WEB-3Z/40: an iPhone at 32kHz was refused with `400 Invalid audio format:
   * unsupported audio_sample_rate 32000` on the first stream of every turn, so the tutor
   * could not speak at all on that device.
   */
  const { rate } = await announcedRate(32_000);

  assert.equal(rate, 24_000, "32kHz is not one of Soniox's rates; the nearest one is asked for");
});

test("a device at a supported rate is still asked for its own", async () => {
  for (const deviceRate of [8_000, 16_000, 24_000, 44_100, 48_000]) {
    const { rate } = await announcedRate(deviceRate);

    assert.equal(rate, deviceRate, `${deviceRate} needs no resampling and must be left alone`);
  }
});

test("audio is decoded at the rate it was generated at, not the device's", async () => {
  const sockets = installGlobals();
  contextRunningAt(32_000);
  const output = new TutorSpeechOutput(config);
  await output.connect();
  const turn = output.speak();
  turn.push("Celica. ");
  await settle();

  const built = [];
  const context = output.context;
  const createBuffer = context.createBuffer.bind(context);
  context.createBuffer = (channels, length, rate) => {
    built.push(rate);

    return createBuffer(channels, length, rate);
  };

  sockets[0].receive({ stream_id: sockets[0].liveStreamId, audio: AUDIO_FRAME });

  assert.deepEqual(built, [24_000], "a buffer built at the context's 32kHz would play back too fast");

  output.close();
  await turn.finished;
});
