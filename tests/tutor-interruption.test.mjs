import assert from "node:assert/strict";
import test from "node:test";

import { judgeHeard } from "../src/lib/tutor/turn-audio.ts";

// What the tutor has actually said out loud by the time the microphone is judged. Empty
// stands for a room the tutor's voice has been out of for a moment — the learner's turn.
const TUTOR_SAID = "Mitohondrij je elektrarna celice, ker v njem nastaja energija";

test("the room does not take the floor", () => {
  // Everything here used to duck the tutor mid-sentence: the recognizer's best effort at
  // a door, a chair, a car outside, somebody breathing near the phone.
  for (const noise of ["", "mhm", "hm hm", "aaaa", "uh", "...", "eee"]) {
    assert.equal(judgeHeard(noise, TUTOR_SAID), "noise", noise);
  }
});

test("one word from a person takes the floor immediately", () => {
  assert.equal(judgeHeard("počakaj", TUTOR_SAID), "learner");
  assert.equal(judgeHeard("kaj?", TUTOR_SAID), "learner");
  assert.equal(judgeHeard("mhm počakaj", TUTOR_SAID), "learner");
});

test("the tutor's own voice off a speaker is the tutor, however much of it comes back", () => {
  for (const echo of [
    "elektrarna",
    "mitohondrij je elektrarna",
    "mito hondrij je elektrarna celice",
    "mhm elektrarna celice ah",
  ]) {
    assert.equal(judgeHeard(echo, TUTOR_SAID), "tutor", echo);
  }
});

test("the learner is never measured against a tutor that is not talking", () => {
  // Their own turn: the room tail is empty, so even the tutor's own sentence read back
  // to it is theirs to say.
  assert.equal(judgeHeard("mitohondrij je elektrarna celice", ""), "learner");
});

/*
 * The failure this whole arrangement exists to prevent.
 *
 * Soniox keeps building one utterance until it hears a pause, and a tutor mid-paragraph
 * never gives it one — so its own voice, leaking off a phone speaker, accumulated in the
 * recognizer's buffer and was still sitting there when the learner finally spoke. The
 * question that reached the model was the tutor's paragraph with the learner's sentence
 * on the end of it.
 */
test("the tutor's voice never ends up on the front of the learner's question", () => {
  let buffer = "";
  const asked = [];

  // One partial per message, the way the socket sends them: each one is everything heard
  // in this utterance so far.
  const hears = (words) => {
    buffer = `${buffer} ${words}`.trim();

    const speaker = judgeHeard(buffer, TUTOR_SAID);

    if (speaker !== "learner") {
      // Dropped from the buffer, not merely ignored. This is the part that was missing,
      // and it is safe because nothing but a word of the learner's is ever kept.
      buffer = "";
    } else {
      asked.push(buffer);
    }
  };

  hears("mitohondrij je");
  hears("elektrarna celice");
  hears("mhm");
  hears("kaj pa kloroplast");

  assert.deepEqual(asked, ["kaj pa kloroplast"]);
});

test("a learner talking through the echo is still heard", () => {
  // Both voices in one transcript — the speaker's leak and the person over the top of it.
  assert.equal(judgeHeard("mitohondrij je počakaj malo", TUTOR_SAID), "learner");
});
