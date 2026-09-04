import assert from "node:assert/strict";
import test from "node:test";

import { canCancelStream } from "../src/lib/tutor/turn-audio.ts";

/*
 * A stream id only means anything to the socket it was announced on.
 *
 * Soniox hangs up on a speech socket about ten seconds after the last audio it made,
 * which for a long turn is while the learner is still listening to it. The turn survives
 * that on purpose — every sample is already scheduled and plays out on its own — but it
 * survived holding an id the *next* socket has never heard of. Starting the next turn
 * stops the one before it, and that stop sent `turn-N` down a fresh connection, which
 * answered `400 Stream turn-N not found. Send a start message first.` By then turn-N was
 * long gone, so the failure landed on the turn just created and paused the session with
 * a connection error the learner had no way to act on.
 */

const SOCKET = Symbol("the socket the turn was announced on");
const OTHER_SOCKET = Symbol("the socket that replaced it");

/** A turn part-way through being spoken: announced, and still being generated. */
function speaking(overrides = {}) {
  return { opened: true, audioComplete: false, socket: SOCKET, ...overrides };
}

test("a turn is never cancelled on a socket that never carried it", () => {
  assert.equal(canCancelStream(speaking(), OTHER_SOCKET), false);
});

test("a stream Soniox has already finished is not cancelled again", () => {
  // `audio_end` means the generating is over and the stream with it. The audio it made
  // is still coming out of the speaker, which is why the turn is still here at all.
  assert.equal(canCancelStream(speaking({ audioComplete: true }), SOCKET), false);
});

test("a turn that was never announced has no stream to cancel", () => {
  // The stream is opened by the first word, not by the intention to speak, so a turn the
  // model never wrote anything for was never named to Soniox.
  assert.equal(canCancelStream(speaking({ opened: false }), SOCKET), false);
});

test("a turn still being generated is still cancelled on interruption", () => {
  // The case the cancel exists for: the learner cuts in, Soniox is still writing audio
  // nobody will hear, and it has to be told to stop.
  assert.equal(canCancelStream(speaking(), SOCKET), true);
});

test("a turn is not cancelled when there is no socket at all", () => {
  // `ensureOpen` drops the dead connection before opening the next one.
  assert.equal(canCancelStream(speaking(), null), false);
});
