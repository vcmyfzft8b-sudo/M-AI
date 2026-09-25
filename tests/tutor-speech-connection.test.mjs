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

test("old teaching words no longer block an interruption but recent speaker echo still does", async () => {
  const { judgeHeard } = await import("../src/lib/tutor/turn-audio.ts");
  installGlobals(); const output = new TutorSpeechOutput(config); await output.connect();
  output.speak();
  const old = "Calcium opens channels. ", recent = "Vesicles release transmitters. ";
  output.turn.text = old + recent;
  output.turn.timings = {
    characters: [...old, ...recent],
    startSeconds: [...old].map(() => 0).concat([...recent].map(() => 10)),
    endSeconds: [...old].map(() => 1).concat([...recent].map(() => 11)),
  };
  output.turn.audioStartedAt = 0; output.turn.scheduledUntil = 30; output.context.currentTime = 12;
  assert.equal(output.spokenIntoRoom(), recent.trim());
  assert.equal(judgeHeard("Calcium", output.spokenIntoRoom()), "learner");
  assert.equal(judgeHeard("Vesicles", output.spokenIntoRoom()), "tutor");
  output.turn.timings = { characters: [], startSeconds: [], endSeconds: [] };
  assert.equal(judgeHeard("Calcium", output.spokenIntoRoom()), "tutor", "missing timestamps keep the conservative echo guard");
  output.close();
});

/*
 * MEMOAI-WEB-48: the close landed while the writer was still mid-sentence, so `turn.finished`
 * was rejected before `runTurn` got as far as awaiting it. The walkthrough handled it — it
 * paused and reported the failure — but Sentry had already taken the orphan rejection and
 * marked the error as seen, so the tutor's own tagged report was dropped as a repeat.
 */
test("a speech connection dropped mid-sentence does not orphan the turn's rejection", async () => {
  const sockets = installGlobals();
  const output = new TutorSpeechOutput(config);
  await output.connect();

  const turn = output.speak();
  turn.push("Mitohondriji proizvajajo ");
  await settle();
  assert.equal(output.turn.segmentOpen, true, "the turn is being fed when the socket goes");

  // Since the mid-sentence reconnect, a loss on a visible page carries on; a page going into
  // the background still fails the turn, which is the case this guards.
  globalThis.document = { visibilityState: "hidden" };
  const orphaned = [];
  const record = (reason) => orphaned.push(reason);
  process.on("unhandledRejection", record);
  sockets[0].close();
  await settle();
  process.off("unhandledRejection", record);
  delete globalThis.document;

  assert.deepEqual(
    orphaned.map((reason) => reason?.message),
    [],
    "the failure belongs to whoever awaits the turn, not to the global handler",
  );
  await assert.rejects(turn.finished, /The speech connection closed\./);
  output.close();
});
