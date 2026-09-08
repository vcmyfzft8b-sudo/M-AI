import assert from "node:assert/strict";
import test from "node:test";
import { audioFrameOf, installGlobals, loadSpeechOutput, settle } from "./tutor-speech-harness.mjs";

const { TutorSpeechOutput } = await loadSpeechOutput();
async function playing() {
  installGlobals();
  const output = new TutorSpeechOutput({ url: "wss://synthetic.invalid", apiKey: "test", model: "tts-rt-v2", voice: "Grace", language: "sl" });
  await output.connect();
  const handle = output.speak();
  handle.push("Kalcij sproži sproščanje prenašalca. ");
  await settle();
  const activeSocket = output.socket;
  const stream = activeSocket.liveStreamId;
  activeSocket.receive({ stream_id: stream, audio: audioFrameOf(2) });
  output.context.currentTime = output.turn.audioStartedAt + 0.5;
  return { output, handle, socket: activeSocket, stream, source: [...output.sources][0] };
}

test("recognized interruption fades for 70ms but invalidates the turn immediately", async () => {
  const { output, handle, socket, stream, source } = await playing();
  const now = output.context.currentTime;
  output.stop({ fadeOut: true });
  await handle.finished;
  assert.equal(output.turn, null);
  assert.deepEqual(output.gain.gain.events.at(-1), ["ramp", 0, now + 0.07]);
  assert.deepEqual(source.stops, [now + 0.07]);
  assert.ok(socket.sent.some(frame => frame.cancel && frame.stream_id === stream));
  socket.receive({ stream_id: stream, audio: audioFrameOf(2) });
  assert.equal(output.sources.size, 0, "late audio cannot extend the fade");
  source.onended();
  assert.equal(output.fadingSources.size, 0);
  output.close();
});

test("Pause or End immediately silences a fade still in progress", async () => {
  const { output, source } = await playing();
  output.stop({ fadeOut: true });
  output.stop();
  assert.equal(source.stops.at(-1), undefined, "hard stop has no scheduled delay");
  assert.equal(output.fadingSources.size, 0);
  output.close();
});

test("replacement speech restores full volume and cannot revive the old fading audio", async () => {
  const { output, source } = await playing();
  output.stop({ fadeOut: true });
  const next = output.speak();
  assert.equal(source.stops.at(-1), undefined);
  assert.deepEqual(output.gain.gain.events.at(-1), ["set", 1, output.context.currentTime]);
  assert.equal(output.fadingSources.size, 0);
  output.close();
  await next.finished;
});

test("interrupting before scheduled playback starts discards it without a fade", async () => {
  const { output, source } = await playing();
  output.context.currentTime = 0;
  output.stop({ fadeOut: true });
  assert.deepEqual(source.stops, [undefined]);
  assert.equal(output.gain.gain.events.some(event => event[0] === "ramp"), false);
  output.close();
});
