import assert from "node:assert/strict";
import test from "node:test";

import {
  audioContexts,
  audioFrameOf,
  installGlobals,
  loadSpeechOutput,
  settle,
  wait,
} from "./tutor-speech-harness.mjs";

/*
 * A turn that outlives a writer that stops writing.
 *
 * Soniox kills a stream it is not fed — 408 `request_timeout` about 5.2 seconds after the
 * last text, and 408 "output audio rate below minimum" at around eleven if the text is too
 * thin to keep the audio near realtime. Both were measured live on `tts-rt-v2` on 2026-09-04.
 * A slow OpenRouter chunk mid-turn therefore used to fail the turn, and the learner was shown
 * a connection error and a paused lesson for it.
 *
 * The turn is now spoken over as many streams as it takes: the open one is finished when the
 * writer goes quiet, and the next word opens another. These tests drive the real class through
 * that, with the quiet deadline shortened — the behaviour under test is what happens when it
 * expires, not how long it is.
 */

const QUIET_MS = 40;

async function speaking() {
  const { TutorSpeechOutput } = await loadSpeechOutput({ quietCloseMs: QUIET_MS });
  const sockets = installGlobals();
  const errors = [];
  const output = new TutorSpeechOutput(
    {
      url: "wss://tts-rt.soniox.com/tts-websocket",
      apiKey: "key",
      model: "tts-rt-v2",
      voice: "Grace",
      language: "en",
    },
    { onError: (error) => errors.push(error) },
  );

  await output.connect();

  const turn = output.speak();

  return { output, sockets, errors, turn, socket: sockets[0] };
}

/** Everything the client sent for one stream, in order. */
const framesFor = (socket, streamId) => socket.sent.filter((frame) => frame.stream_id === streamId);

test("a writer that goes quiet has its stream finished rather than left to be killed", async () => {
  const { output, errors, socket, turn } = await speaking();

  turn.push("The mitochondrion is the powerhouse of the cell. ");
  await settle();

  const first = socket.liveStreamId;
  assert.equal(framesFor(socket, first).some((frame) => frame.text_end), false);

  await wait(QUIET_MS * 3);

  // Closed by us, on our clock, well inside the 5.2 seconds Soniox allows.
  assert.equal(
    framesFor(socket, first).some((frame) => frame.text_end === true),
    true,
  );
  assert.deepEqual(errors, []);

  output.close();
});

test("the turn carries on after the stall, on a stream of its own", async () => {
  const { output, errors, socket, turn } = await speaking();

  turn.push("The mitochondrion is the powerhouse of the cell. ");
  await settle();

  const first = socket.liveStreamId;
  await wait(QUIET_MS * 3);

  // The writer comes back. Nothing may be announced until the closed stream is done.
  turn.push("It has two membranes rather than one. ");
  await settle();
  assert.deepEqual(socket.announced, [first]);

  socket.receive({ stream_id: first, terminated: true });
  await settle();

  const second = socket.liveStreamId;
  assert.notEqual(second, first);
  assert.deepEqual(socket.announced, [first, second]);
  assert.deepEqual(
    framesFor(socket, second)
      .filter((frame) => typeof frame.text === "string" && frame.text)
      .map((frame) => frame.text),
    ["It has two membranes rather than one. "],
  );
  assert.deepEqual(errors, []);

  output.close();
});

test("the second stream's timings are placed on the turn's clock, not their own", async () => {
  const { output, socket, turn } = await speaking();

  /*
   * Each stream numbers its character timestamps from its own zero. Read straight, the second
   * stream's first word would claim the moment the turn began — so a learner cutting in would
   * have the whole of it recorded as already heard, and the echo test would be listening for
   * words that are still queued. Placed on the turn's clock, it starts where its audio was
   * scheduled: after everything the first stream had already put in the room.
   */
  const chars = (text, from, step) => ({
    characters: [...text],
    character_start_times_seconds: [...text].map((_, index) => from + index * step),
    character_end_times_seconds: [...text].map((_, index) => from + index * step + step),
  });

  turn.push("Alpha ");
  await settle();
  const first = socket.liveStreamId;
  socket.receive({ stream_id: first, audio: audioFrameOf(1), timestamps: chars("Alpha ", 0, 0.2) });
  await settle();

  await wait(QUIET_MS * 3);
  turn.push("Beta ");
  await settle();
  socket.receive({ stream_id: first, terminated: true });
  await settle();

  const second = socket.liveStreamId;
  socket.receive({ stream_id: second, audio: audioFrameOf(1), timestamps: chars("Beta ", 0, 0.2) });
  await settle();

  /*
   * A second and a half in: all of the first stream has been heard and the second is a fifth
   * of the way through its own second of audio. Without the offset every character of "Beta"
   * would claim to have been said before this moment, and the room would be told so.
   */
  audioContexts.at(-1).currentTime = 1.5;

  assert.equal(output.spokenIntoRoom(), "Alpha");

  output.close();
});

test("the record of what was said keeps the space between two streams", async () => {
  const { output, socket, turn } = await speaking();

  const chars = (text, step) => ({
    characters: [...text],
    character_start_times_seconds: [...text].map((_, index) => index * step),
    character_end_times_seconds: [...text].map((_, index) => index * step + step),
  });

  turn.push("cristae. ");
  await settle();
  const first = socket.liveStreamId;

  /*
   * Soniox reports every character it was given except the space a stream ends on — measured,
   * 215 of 216. Left out, the two segments run together as "cristae.Along", and that string is
   * the record an interruption is cut from.
   */
  socket.receive({ stream_id: first, audio: audioFrameOf(1), timestamps: chars("cristae.", 0.1) });
  await settle();

  await wait(QUIET_MS * 3);
  turn.push("Along those folds ");
  await settle();
  socket.receive({ stream_id: first, terminated: true });
  await settle();

  const second = socket.liveStreamId;
  socket.receive({
    stream_id: second,
    audio: audioFrameOf(1),
    timestamps: chars("Along those folds", 0.05),
  });
  await settle();

  audioContexts.at(-1).currentTime = 10;
  const { spokenText } = output.stop();

  assert.equal(spokenText, "cristae. Along those folds");

  output.close();
});

test("the turn is only over when its last stream is", async () => {
  const { output, socket, turn } = await speaking();

  turn.push("Alpha ");
  await settle();
  const first = socket.liveStreamId;

  await wait(QUIET_MS * 3);
  turn.push("Beta ");
  await settle();
  socket.receive({ stream_id: first, terminated: true });
  await settle();

  const second = socket.liveStreamId;
  turn.end();
  await settle();

  let over = false;
  void turn.finished.then(() => {
    over = true;
  });

  // The writer is done, but the last stream is still making audio.
  await settle();
  assert.equal(over, false);

  socket.receive({ stream_id: second, terminated: true });
  await settle();
  assert.equal(over, true);

  output.close();
});

test("the late end of a finished stream does not orphan the one that replaced it", async () => {
  const { output, errors, socket, turn } = await speaking();

  turn.push("Alpha ");
  await settle();
  const first = socket.liveStreamId;

  await wait(QUIET_MS * 3);
  turn.push("Beta ");
  await settle();

  /*
   * Soniox ends a stream twice: `audio_end` on its last audio frame, then `terminated`. The
   * first releases the next segment, so the second names a stream the turn has moved past.
   * Read as the live segment's, it marks one that is still being fed as closed, and the words
   * already sent to it sit there until Soniox times it out — which is a 408 mid-lesson, and
   * the whole thing this file exists to prevent. Measured against tts-rt-v2 before it was fixed.
   */
  socket.receive({ stream_id: first, audio_end: true });
  await settle();

  const second = socket.liveStreamId;
  assert.notEqual(second, first);

  socket.receive({ stream_id: first, terminated: true });
  await settle();

  // The live segment is still the live segment, and the turn's end closes it rather than a third.
  turn.end();
  await settle();

  assert.deepEqual(socket.announced, [first, second]);
  assert.equal(
    framesFor(socket, second).some((frame) => frame.text_end === true),
    true,
  );
  assert.deepEqual(errors, []);

  output.close();
});

test("a starved stream is recovered from rather than shown to the learner", async () => {
  const { output, errors, socket, turn } = await speaking();

  turn.push("The mitochondrion is the powerhouse of the cell. ");
  await settle();

  const first = socket.liveStreamId;

  // Soniox synthesized the opening and then killed the stream for falling behind.
  socket.receive({
    stream_id: first,
    timestamps: {
      characters: [..."The mitochondrion "],
      character_start_times_seconds: [..."The mitochondrion "].map((_, index) => index * 0.05),
      character_end_times_seconds: [..."The mitochondrion "].map((_, index) => index * 0.05 + 0.05),
    },
  });
  socket.receive({
    stream_id: first,
    error_code: 408,
    error_message: "Stream killed: output audio rate below minimum",
    error_type: "request_timeout",
  });
  await settle();

  // The lesson does not stop, and the words that never became audio are said on the next stream.
  assert.deepEqual(errors, []);

  const second = socket.liveStreamId;
  assert.notEqual(second, first);
  assert.deepEqual(
    framesFor(socket, second)
      .filter((frame) => typeof frame.text === "string" && frame.text)
      .map((frame) => frame.text),
    ["is the powerhouse of the cell. "],
  );

  output.close();
});

test("a connection that dies during the stall is replaced, not blamed", async () => {
  const { output, errors, sockets, socket, turn } = await speaking();

  turn.push("The mitochondrion is the powerhouse of the cell. ");
  await settle();

  const first = socket.liveStreamId;
  await wait(QUIET_MS * 3);
  socket.receive({ stream_id: first, terminated: true });
  await settle();

  /*
   * Soniox hangs up on a connection with nothing left to generate about ten seconds later,
   * which any stall worth the name reaches. It is the ordinary end of a stall, not a fault.
   */
  socket.close();
  await settle();

  assert.deepEqual(errors, []);

  turn.push("It has two membranes rather than one. ");
  await settle();

  assert.equal(sockets.length, 2);
  assert.equal(sockets[1].announced.length, 1);
  assert.deepEqual(
    framesFor(sockets[1], sockets[1].liveStreamId)
      .filter((frame) => typeof frame.text === "string" && frame.text)
      .map((frame) => frame.text),
    ["It has two membranes rather than one. "],
  );

  output.close();
});

test("a turn whose writer produced nothing still finishes", async () => {
  const { output, socket, turn } = await speaking();

  turn.end();
  await turn.finished;

  assert.deepEqual(socket.announced, []);

  output.close();
});

/*
 * Backlog investigate:tutor-speech-socket-closes-mid-segment (2026-09-20): the speech
 * connection closed while a segment was still being fed, and the close listener failed the
 * whole turn — a red box mid-lesson — although drain already knew how to replace a lost
 * connection and the 408 path already knew how to hand a remainder on.
 */
const firstWords = (socket, streamId, text) => socket.receive({
  stream_id: streamId,
  timestamps: {
    characters: [...text],
    character_start_times_seconds: [...text].map((_, index) => index * 0.05),
    character_end_times_seconds: [...text].map((_, index) => index * 0.05 + 0.05),
  },
});

test("a connection lost mid-sentence carries the unspoken rest to a new one", async () => {
  const { output, errors, sockets, socket, turn } = await speaking();
  let failed = null;
  turn.finished.catch((error) => { failed = error; });

  turn.push("The mitochondrion is the powerhouse of the cell. ");
  await settle();
  firstWords(socket, socket.liveStreamId, "The mitochondrion ");

  socket.close();
  await settle(); await settle();

  assert.equal(failed, null, "the turn carries on");
  assert.deepEqual(errors, []);
  assert.equal(sockets.length, 2, "a new connection");
  const texts = framesFor(sockets[1], sockets[1].liveStreamId).filter((f) => typeof f.text === "string" && f.text).map((f) => f.text);
  assert.deepEqual(texts, ["is the powerhouse of the cell. "], "only what was never turned into sound is sent again");
  assert.equal(output.turn.reconnects, 1);
  output.close();
});

test("a closed segment still generating loses nothing either", async () => {
  const { output, sockets, socket, turn } = await speaking();
  let failed = null;
  turn.finished.catch((error) => { failed = error; });

  turn.push("Cristae fold the inner membrane. ");
  await settle();
  const first = socket.liveStreamId;
  await wait(QUIET_MS * 2);
  assert.ok(framesFor(socket, first).some((frame) => frame.text_end), "the quiet writer's segment was closed");
  firstWords(socket, first, "Cristae ");

  socket.close();
  await settle(); await settle();

  assert.equal(failed, null);
  const texts = framesFor(sockets[1], sockets[1].liveStreamId).filter((f) => typeof f.text === "string" && f.text).map((f) => f.text);
  assert.deepEqual(texts, ["fold the inner membrane. "]);
  output.close();
});

test("a third loss in one turn is a connection that is not coming back", async () => {
  const { output, sockets, turn } = await speaking();
  turn.push("One sentence that keeps being cut off. ");
  await settle();

  for (let lost = 0; lost < 3; lost += 1) {
    sockets.at(-1).close();
    await settle(); await settle();
  }

  await assert.rejects(turn.finished, /The speech connection closed\./);
  assert.equal(sockets.length, 3, "two reconnects, then no more");
  output.close();
});

test("on a hidden page a mid-sentence loss fails the turn as before", async () => {
  const { output, sockets, socket, turn } = await speaking();
  turn.push("A sentence nobody is watching. ");
  await settle();
  globalThis.document = { visibilityState: "hidden" };
  try {
    socket.close();
    await settle();
    await assert.rejects(turn.finished, /The speech connection closed\./);
    assert.equal(sockets.length, 1, "no reconnect for a page in the background");
  } finally {
    delete globalThis.document;
    output.close();
  }
});

test("a connection that cannot be replaced fails the turn instead of dropping its words", async () => {
  const { output, socket, turn } = await speaking();
  turn.push("Words that need a connection. ");
  await settle();
  const Real = globalThis.WebSocket;
  globalThis.WebSocket = function () { throw new Error("offline"); };
  try {
    socket.close();
    await settle(); await settle();
    await assert.rejects(turn.finished, /The speech connection closed\./);
  } finally {
    globalThis.WebSocket = Real;
    output.close();
  }
});
