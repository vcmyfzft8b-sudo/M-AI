import assert from "node:assert/strict";
import test from "node:test";

import {
  appendCharacterTimings,
  createEmptyCharacterTimings,
  frameLevel,
  hasSpokenWord,
  isTutorEcho,
  LevelEnvelope,
  SpeechTextBuffer,
  spokenTextBefore,
  stripAudioTags,
} from "../src/lib/tutor/turn-audio.ts";

// One frame per audio packet, each carrying the characters spoken in it — the shape the Soniox
// TTS WebSocket sends when return_timestamps is on.
function frame(text, startSeconds, stepSeconds) {
  const characters = [...text];

  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => startSeconds + i * stepSeconds),
    character_end_times_seconds: characters.map((_, i) => startSeconds + (i + 1) * stepSeconds),
  };
}

function timingsFor(text, stepSeconds = 0.1) {
  return appendCharacterTimings(createEmptyCharacterTimings(), frame(text, 0, stepSeconds));
}

test("an interrupted turn is recorded at the last word actually heard", () => {
  // "Mitohondrij je elektrarna" at 0.1s a character: the learner cuts in at 1.5s,
  // by which point the speaker has reached the first letter of "elektrarna".
  const timings = timingsFor("Mitohondrij je elektrarna");

  assert.equal(spokenTextBefore(timings, 1.5, "Mitohondrij je elektrarna"), "Mitohondrij je");
});

test("a cut inside a word falls back to the last whole one", () => {
  const timings = timingsFor("Foto sinteza je proces");

  // 0.8s lands four characters into "sinteza"; a mid-word record would read as a typo.
  assert.equal(spokenTextBefore(timings, 0.8, "Foto sinteza je proces"), "Foto");
});

test("an uninterrupted turn keeps every word", () => {
  const text = "Mitohondrij je elektrarna";

  assert.equal(spokenTextBefore(timingsFor(text), 999, text), text);
});

test("an interruption before the first syllable records nothing", () => {
  assert.equal(spokenTextBefore(timingsFor("Mitohondrij"), 0, "Mitohondrij"), "");
});

test("a stream that sent no timings falls back to the whole turn", () => {
  // Repeating material is worse than skipping it, so the safe fallback is "all of it".
  assert.equal(spokenTextBefore(null, 0.5, "Mitohondrij je elektrarna"), "Mitohondrij je elektrarna");
});

const TUTOR_SAID = "Mitohondrij je elektrarna celice, ker v njem nastaja energija";

test("the tutor's own voice coming back off a speaker is never the learner", () => {
  assert.equal(isTutorEcho("mitohondrij je elektrarna celice", TUTOR_SAID), true);
});

test("one leaked word is still the tutor, not an interruption", () => {
  // The bar for taking the floor is a single word now, so a single word of echo has to
  // be caught — this is the case that would otherwise stop the lesson on a phone speaker.
  assert.equal(isTutorEcho("elektrarna", TUTOR_SAID), true);
});

test("echo the recognizer split or joined is still echo", () => {
  // A speaker's voice through a room comes back with seams in the wrong places.
  assert.equal(isTutorEcho("mito hondrij", TUTOR_SAID), true);
  assert.equal(isTutorEcho("elektrarn", TUTOR_SAID), true);
});

test("noises sprinkled through an echo do not turn it into a question", () => {
  assert.equal(isTutorEcho("mhm elektrarna ah", TUTOR_SAID), true);
});

test("a real question over the tutor's voice gets through", () => {
  assert.equal(isTutorEcho("razloži mi to kot da imam pet let", TUTOR_SAID), false);
});

test("one word of the learner's own is enough to break an echo", () => {
  // The echo is there — the microphone hears the room — but "počakaj" is not the tutor's.
  assert.equal(isTutorEcho("mitohondrij je počakaj", TUTOR_SAID), false);
});

test("an ending the recognizer heard differently is still the tutor's word", () => {
  /*
   * The reported failure. A speaker's voice comes back with its case endings mangled — Slovenian
   * carries them on the last letter or two — and containment cannot see past that, because
   * neither "elektrarno" nor "elektrarna" sits inside the other. One word like that used to rule
   * the whole utterance a learner's and stop the lesson mid-sentence.
   */
  assert.equal(isTutorEcho("mitohondrij je elektrarno celice", TUTOR_SAID), true);
  assert.equal(isTutorEcho("mitohondriju je elektrarni celici", TUTOR_SAID), true);
});

test("words that merely start alike are still different words", () => {
  // The slack forgives an ending, not a stem: a learner asking about something else that happens
  // to begin the same way must still be heard.
  assert.equal(isTutorEcho("razlika", TUTOR_SAID), false);
  assert.equal(isTutorEcho("energijo porabi kdo", TUTOR_SAID), false);
});

const TUTOR_SAID_AT_LENGTH =
  "Mitohondrij je elektrarna celice, ker v njem nastaja energija, ki jo potem porabi vse " +
  "drugo v telesu, od mišic do možganov, in prav zato ga imenujemo elektrarna";

test("a stray word in a whole leaked paragraph does not stop the lesson", () => {
  /*
   * Several seconds of speaker audio come back with the odd word invented. Ruling that an
   * interruption is what stopped a real session — so a long utterance forgives a small share of
   * strangers, where a short one forgives none.
   */
  assert.equal(
    isTutorEcho(
      "mitohondrij je elektrarna celice ker v njem nastaja energija ki jo potem porabi vse drugo v telesu televizor",
      TUTOR_SAID_AT_LENGTH,
    ),
    true,
  );
});

test("a long utterance that is mostly the learner's own words is theirs", () => {
  // The slack is a small share, not a licence: this is somebody talking, and it must get through.
  assert.equal(
    isTutorEcho(
      "mitohondrij je elektrarna ampak počakaj nisem razumel zakaj se to sploh dogaja v celici",
      TUTOR_SAID_AT_LENGTH,
    ),
    false,
  );
});

test("a short interruption never gets the benefit of the doubt", () => {
  // Below eight words the tutor still yields on one word of the learner's — unchanged.
  assert.equal(isTutorEcho("mitohondrij je počakaj", TUTOR_SAID), false);
  assert.equal(isTutorEcho("elektrarna počakaj", TUTOR_SAID), false);
});

test("nothing is echo while the tutor's voice is not in the room", () => {
  // What the learner says in their own turn is never measured against the tutor.
  assert.equal(isTutorEcho("mitohondrij je elektrarna celice", ""), false);
});

test("a noise does not take the floor", () => {
  for (const noise of ["", "mhm", "hmmm", "uh", "aha", "eee", "ah", "...", "mmm mhm"]) {
    assert.equal(hasSpokenWord(noise), false, noise);
  }
});

test("one actual word takes the floor", () => {
  for (const said of ["počakaj", "ne", "wait", "kaj?", "mhm počakaj"]) {
    assert.equal(hasSpokenWord(said), true, said);
  }
});

test("text is held back at a half word and released at the next space", () => {
  const buffer = new SpeechTextBuffer();

  // A piece cut mid-word is pronounced as two words, and the seam is audible.
  assert.equal(buffer.push("Mitohon"), "");
  assert.equal(buffer.push("drij je "), "Mitohondrij je ");
  assert.equal(buffer.push("elektrarna"), "");
  assert.equal(buffer.flush(), "elektrarna");
});

test("the level of a frame is its plain loudness, whatever it is made of", () => {
  // 20ms of a 1 kHz tone, the way the recorder hands audio over.
  const samples = new Int16Array(960);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * 1_000 * index) / 48_000) * 0.3 * 0x7fff;
  }

  // RMS of a sine is its amplitude over root two.
  assert.ok(Math.abs(frameLevel(samples) - 0.3 / Math.SQRT2) < 0.01);
  assert.equal(frameLevel(new Int16Array(960)), 0);
  assert.equal(frameLevel(new Float32Array([1, -1, 1, -1])), 1);
});

test("the level envelope rises fast and falls slowly", () => {
  const envelope = new LevelEnvelope(0.35, 0.08);

  // A syllable arrives: the shape should be most of the way there within a few frames.
  let value = 0;
  for (let i = 0; i < 6; i += 1) value = envelope.push(1);
  assert.ok(value > 0.85, `expected a fast attack, got ${value}`);

  // The gap between two words must not read as the tutor stopping.
  const afterOneQuietFrame = envelope.push(0);
  assert.ok(afterOneQuietFrame > 0.8, `expected a slow release, got ${afterOneQuietFrame}`);
});

test("the level envelope settles to exactly zero when the voice stops", () => {
  const envelope = new LevelEnvelope();
  envelope.push(1);

  for (let i = 0; i < 400; i += 1) envelope.push(0);

  assert.equal(envelope.push(0), 0);
});

test("audio tags are performed, not recorded as words", () => {
  // The synthesizer never says these, but they do come back in the character timestamps.
  assert.equal(
    stripAudioTags("[clears throat] Mitohondrij je elektrarna celice. [laughs] Res je."),
    "Mitohondrij je elektrarna celice. Res je.",
  );
});

test("stripping a tag does not leave a space before the punctuation", () => {
  assert.equal(stripAudioTags("To je vse [sighs] , kar je pomembno."), "To je vse, kar je pomembno.");
});

test("an interrupted turn's record has its tags removed too", () => {
  const timings = timingsFor("[laughs] Foto sinteza je proces");

  // The tag's characters carry timings like any other, so without stripping they would
  // land in the conversation history as a word the tutor supposedly said.
  assert.equal(spokenTextBefore(timings, 99, "[laughs] Foto sinteza je proces"), "Foto sinteza je proces");
});
