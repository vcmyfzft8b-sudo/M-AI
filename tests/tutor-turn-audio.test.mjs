import assert from "node:assert/strict";
import test from "node:test";

import {
  appendCharacterTimings,
  createEmptyCharacterTimings,
  isEchoOfTutor,
  isSubstantialInterruption,
  LevelEnvelope,
  SpeechTextBuffer,
  spokenTextBefore,
  stripAudioTags,
  VoiceActivityDetector,
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

test("the tutor's own voice coming back off a speaker is not an interruption", () => {
  const tutorSaid = "Mitohondrij je elektrarna celice, ker v njem nastaja energija";

  assert.equal(isEchoOfTutor("mitohondrij je elektrarna celice", tutorSaid), true);
});

test("a real question during the same sentence still gets through", () => {
  const tutorSaid = "Mitohondrij je elektrarna celice, ker v njem nastaja energija";

  assert.equal(isEchoOfTutor("razloži mi to kot da imam pet let", tutorSaid), false);
});

test("a learner repeating one word of the tutor's is not treated as echo", () => {
  const tutorSaid = "Mitohondrij je elektrarna celice";

  // Two words, one of them the tutor's: below the four-fifths bar, so it is a person.
  assert.equal(isEchoOfTutor("kaj je mitohondrij", tutorSaid), false);
});

test("a cough or a hum does not take the floor", () => {
  assert.equal(isSubstantialInterruption("mhm"), false);
  assert.equal(isSubstantialInterruption("ja"), false);
  assert.equal(isSubstantialInterruption(""), false);
});

test("two words or a dozen characters do take the floor", () => {
  assert.equal(isSubstantialInterruption("počakaj malo"), true);
  assert.equal(isSubstantialInterruption("ne razumem"), true);
});

test("text is held back at a half word and released at the next space", () => {
  const buffer = new SpeechTextBuffer();

  // A piece cut mid-word is pronounced as two words, and the seam is audible.
  assert.equal(buffer.push("Mitohon"), "");
  assert.equal(buffer.push("drij je "), "Mitohondrij je ");
  assert.equal(buffer.push("elektrarna"), "");
  assert.equal(buffer.flush(), "elektrarna");
});

test("the detector waits for sustained sound before calling it speech", () => {
  const detector = new VoiceActivityDetector({ attackFrames: 3, releaseFrames: 4 });

  // One loud frame is a door, not a person.
  assert.equal(detector.push(0.4), null);
  assert.equal(detector.push(0.002), null);
  assert.equal(detector.isSpeaking, false);

  assert.equal(detector.push(0.4), null);
  assert.equal(detector.push(0.4), null);
  assert.equal(detector.push(0.4), "start");
  assert.equal(detector.isSpeaking, true);
});

test("the detector holds through the pauses inside a sentence", () => {
  const detector = new VoiceActivityDetector({ attackFrames: 2, releaseFrames: 6 });

  detector.push(0.4);
  assert.equal(detector.push(0.4), "start");

  // A short breath mid-question must not end the utterance.
  for (let i = 0; i < 5; i += 1) {
    assert.equal(detector.push(0.001), null);
  }

  assert.equal(detector.push(0.001), "end");
});

test("the detector learns a noisy room rather than hearing it as speech", () => {
  const detector = new VoiceActivityDetector({ attackFrames: 3 });

  // A steady fan at a level that would clear the absolute floor on its own.
  for (let i = 0; i < 200; i += 1) {
    detector.push(0.03);
  }

  assert.equal(detector.isSpeaking, false);
  assert.ok(detector.threshold > 0.03, "the threshold should have risen above the room");
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
