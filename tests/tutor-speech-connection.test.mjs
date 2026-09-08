import assert from "node:assert/strict";
import test from "node:test";
import { installGlobals, loadSpeechOutput, settle, FakeSocket } from "./tutor-speech-harness.mjs";

const { TutorSpeechOutput } = await loadSpeechOutput();
const config = { url: "wss://synthetic.invalid", apiKey: "test", model: "tts-rt-v2", voice: "Grace", language: "sl" };

test("interrupted preparation and its replacement reuse the pending speech connection", async () => {
  const sockets = installGlobals();
  const output = new TutorSpeechOutput(config);
  await output.connect();
  sockets[0].close();
  const first = output.ensureOpen();
  const replacement = output.ensureOpen();
  assert.equal(sockets.length, 2, "one initial socket and one replacement, not two replacements");
  await Promise.all([first, replacement]);
  output.close();
});

test("ending the session while a speech connection opens cannot resurrect it", async () => {
  const sockets = installGlobals();
  const output = new TutorSpeechOutput(config);
  await output.connect();
  sockets[0].close();
  const pending = output.ensureOpen();
  output.close();
  await pending; await settle();
  assert.equal(sockets[1].readyState, FakeSocket.CLOSED);
  assert.equal(output.socket, null);
  await assert.rejects(output.ensureOpen(), /closed/);
});

test("late frames from a replaced speech socket cannot fail the new turn", async () => {
  const sockets = installGlobals();
  const output = new TutorSpeechOutput(config);
  await output.connect();
  sockets[0].close();
  await output.ensureOpen();
  const turn = output.speak();
  turn.push("Nova razlaga. ");
  await settle();
  sockets[0].receive({ error_code: 401, error_message: "old connection expired" });
  assert.notEqual(output.turn, null);
  output.close();
  await turn.finished;
});
