import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIO_FRAME,
  installGlobals,
  loadSpeechOutput,
  settle,
} from "./tutor-speech-harness.mjs";

/*
 * The speech socket's error frames, driven through the real class.
 *
 * Every frame Soniox sends names the stream it belongs to, and `handleMessage` drops
 * the ones that name a turn other than the one being spoken — otherwise a dead turn's
 * error fails whichever turn happens to be live, and `onError` pauses the lesson
 * (MEMOAI-WEB-3D). The frames below are transcripts: each was captured from
 * `wss://tts-rt.soniox.com/tts-websocket` on `tts-rt-v2`, 2026-09-04.
 *
 * A turn is spoken over one stream or several — see the stall tests — so the ids here are
 * read back from what the client announced rather than written out. What matters to these
 * tests is whether a frame belongs to the live turn, not what the client chose to call it.
 */

/** A connected output with one turn already being spoken, and the errors it reported. */
async function speaking() {
  const { TutorSpeechOutput } = await loadSpeechOutput();
  const sockets = installGlobals();
  const errors = [];
  const output = new TutorSpeechOutput(
    {
      url: "wss://tts-rt.soniox.com/tts-websocket",
      apiKey: "key",
      model: "tts-rt-v2",
      voice: "sloane",
      language: "en",
    },
    { onError: (error) => errors.push(error) },
  );

  await output.connect();

  const turn = output.speak();
  turn.push("Photosynthesis is ");
  await settle();

  return { output, sockets, errors, turn, socket: sockets[0] };
}

/*
 * Captured live. The turn is over, its stream is gone from Soniox's side, and the
 * cancel that named it comes back as an error against a session that has moved on.
 */
const staleStreamError = (streamId) => ({
  stream_id: streamId,
  error_code: 400,
  error_message: `Stream ${streamId} not found. Send a start message first.`,
  error_type: "invalid_stream_state",
  more_info: "https://soniox.com/docs/api-reference/errors#invalid-stream-state",
  request_id: "100b4862-a51f-4f27-b663-a6e751c7b30c",
});

test("an error naming a turn that has been replaced is not the live turn's", async () => {
  const { output, errors, socket } = await speaking();

  const dead = socket.liveStreamId;
  const interrupted = output.speak();
  interrupted.push("Actually, ");
  await settle();

  socket.receive(staleStreamError(dead));
  await settle();

  assert.deepEqual(errors, []);
  // The turn that is actually being spoken is untouched: its audio still plays.
  socket.receive({ stream_id: socket.liveStreamId, audio: AUDIO_FRAME });
  assert.equal(output.isSpeaking, true);

  output.close();
});

test("an error naming a turn that ended long ago is ignored", async () => {
  const { output, errors, socket, turn } = await speaking();

  const dead = socket.liveStreamId;
  output.stop();
  await turn.finished;

  socket.receive(staleStreamError(dead));
  await settle();

  assert.deepEqual(errors, []);

  output.close();
});

test("an error arriving on a replaced socket cannot fail the turn on the new one", async () => {
  const { output, errors, sockets, socket, turn } = await speaking();

  const dead = socket.liveStreamId;
  // Soniox finished the audio and then hung up, which is what `ensureOpen` exists for.
  turn.end();
  await settle();
  socket.receive({ stream_id: dead, audio_end: true });
  await turn.finished;
  socket.close();
  await settle();

  await output.ensureOpen();

  const next = output.speak();
  next.push("Next, ");
  await settle();

  assert.notEqual(sockets[1], socket);
  socket.receive(staleStreamError(dead));
  await settle();

  assert.deepEqual(errors, []);

  output.close();
});

test("an error naming the turn being spoken still fails it", async () => {
  const { output, errors, socket, turn } = await speaking();

  /*
   * A rejected key, captured live on tts-rt-v2. Every 408 this socket sees is a starved
   * stream and is recovered from rather than surfaced — see the stall tests — but every
   * other error naming the live turn is a real fault and has to reach the learner.
   */
  socket.receive({
    stream_id: socket.liveStreamId,
    error_code: 401,
    error_message: "Invalid API key.",
    error_type: "unauthenticated",
    more_info: "https://soniox.com/docs/api-reference/errors#unauthenticated",
    request_id: "b68a1c89-a834-4da0-9c57-e8034ac2956f",
  });

  await assert.rejects(turn.finished, (error) => {
    assert.equal(error.name, "SpeechOutputError");
    assert.equal(error.code, "401");
    assert.equal(error.message, "Invalid API key.");

    return true;
  });

  assert.equal(errors.length, 1);

  output.close();
});

test("an error Soniox could not attribute to a stream still reaches the learner", async () => {
  const { output, errors, socket, turn } = await speaking();

  // Soniox sends an empty id when the failure belongs to no stream it could identify.
  socket.receive({
    stream_id: "",
    error_code: 400,
    error_message: "Missing stream_id",
    error_type: "invalid_request",
    more_info: "https://soniox.com/docs/api-reference/errors#invalid-request",
    request_id: "1fda0b92-e0b2-46aa-bfab-64dda5543071",
  });

  await assert.rejects(turn.finished);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, "Missing stream_id");

  output.close();
});

test("an error frame with no stream id at all still reaches the learner", async () => {
  const { output, errors, socket, turn } = await speaking();

  socket.receive({ error_code: 401, error_message: "Incorrect API key provided." });

  await assert.rejects(turn.finished);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "401");

  output.close();
});
