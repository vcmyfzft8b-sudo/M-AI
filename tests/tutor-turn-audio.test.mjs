import assert from "node:assert/strict";
import test from "node:test";

import {
  appendCharacterTimings,
  createEmptyCharacterTimings,
  isEchoOfTutor,
  isSubstantialInterruption,
  LevelEnvelope,
  SpeechBandAnalyser,
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

// A frame of somebody talking: most of its energy in the band a voice lives in.
function voice(level) {
  return { level, voice: level, rumble: level * 0.5, hiss: level * 0.3 };
}

// A frame of a room: loud, and nowhere near the voice band.
function rumble(level) {
  return { level, voice: level * 0.15, rumble: level, hiss: level * 0.05 };
}

function hiss(level) {
  return { level, voice: level * 0.2, rumble: level * 0.05, hiss: level };
}

test("the detector waits for sustained sound before calling it speech", () => {
  const detector = new VoiceActivityDetector({ attackFrames: 3, releaseFrames: 4 });

  // One loud frame is a door, not a person.
  assert.equal(detector.push(voice(0.4)), null);
  assert.equal(detector.push(voice(0.002)), null);
  assert.equal(detector.isSpeaking, false);

  assert.equal(detector.push(voice(0.4)), null);
  assert.equal(detector.push(voice(0.4)), null);
  assert.equal(detector.push(voice(0.4)), "start");
  assert.equal(detector.isSpeaking, true);
});

test("the detector holds through the pauses inside a sentence", () => {
  const detector = new VoiceActivityDetector({ attackFrames: 2, releaseFrames: 6 });

  detector.push(voice(0.4));
  assert.equal(detector.push(voice(0.4)), "start");

  // A short breath mid-question must not end the utterance.
  for (let i = 0; i < 5; i += 1) {
    assert.equal(detector.push(voice(0.001)), null);
  }

  assert.equal(detector.push(voice(0.001)), "end");
});

test("the detector learns a noisy room rather than hearing it as speech", () => {
  const detector = new VoiceActivityDetector({ attackFrames: 3 });

  // A steady fan at a level that would clear the absolute floor on its own.
  for (let i = 0; i < 200; i += 1) {
    detector.push(voice(0.03));
  }

  assert.equal(detector.isSpeaking, false);
  assert.ok(detector.threshold > 0.03, "the threshold should have risen above the room");
});

test("a closure inside a word does not restart the count towards speech", () => {
  const detector = new VoiceActivityDetector({ attackFrames: 4 });

  // The silent moment inside a /p/ is a frame or two long and must not undo the word.
  assert.equal(detector.push(voice(0.4)), null);
  assert.equal(detector.push(voice(0.4)), null);
  assert.equal(detector.push(voice(0.0005)), null);
  assert.equal(detector.push(voice(0.4)), null);
  assert.equal(detector.push(voice(0.4)), null);
  assert.equal(detector.push(voice(0.4)), "start");
});

test("traffic and a fan never reach the tutor however loud they get", () => {
  const detector = new VoiceActivityDetector();

  // A car going past outside: as loud as a shout, all of it under the voice.
  for (let i = 0; i < 200; i += 1) {
    assert.equal(detector.push(rumble(0.6)), null);
  }

  assert.equal(detector.isSpeaking, false);
});

test("a turned page and a keyboard never reach it either", () => {
  const detector = new VoiceActivityDetector();

  for (let i = 0; i < 200; i += 1) {
    assert.equal(detector.push(hiss(0.5)), null);
  }

  assert.equal(detector.isSpeaking, false);
});

test("a question asked over that noise still takes the floor", () => {
  const detector = new VoiceActivityDetector();

  // Sitting in the car with the engine running: the rumble does not stop when
  // the learner speaks, it is simply no longer the loudest thing.
  for (let i = 0; i < 200; i += 1) {
    detector.push(rumble(0.4));
  }

  let started = false;

  for (let i = 0; i < 10; i += 1) {
    started ||= detector.push({ level: 0.5, voice: 0.3, rumble: 0.4, hiss: 0.1 }) === "start";
  }

  assert.ok(started, "a voice over traffic must still be heard as a voice");
});

test("a long sound does not fire again the moment it stops", () => {
  const detector = new VoiceActivityDetector({ attackFrames: 5, releaseFrames: 24 });

  // Somebody reading a paragraph aloud holds the detector open for hundreds of frames,
  // its dips too short to release it. When they finally stop, that must be the end of it —
  // an attack count left standing by all those frames would start a fresh duck at once.
  for (let i = 0; i < 400; i += 1) {
    detector.push(voice(i % 6 === 5 ? 0.02 : 0.4));
  }

  assert.equal(detector.isSpeaking, true);

  let ended = 0;
  let restarted = 0;

  for (let i = 0; i < 100; i += 1) {
    const move = detector.push(voice(0.0005));
    ended += move === "end" ? 1 : 0;
    restarted += move === "start" ? 1 : 0;
  }

  assert.equal(ended, 1);
  assert.equal(restarted, 0);
});

test("a fan switched on mid-lesson is learned instead of ducking forever", () => {
  const detector = new VoiceActivityDetector();
  let starts = 0;

  // Two seconds of a quiet room, then a hum inside the voice band that never stops.
  for (let i = 0; i < 100; i += 1) {
    detector.push(voice(0.0005));
  }

  for (let i = 0; i < 600; i += 1) {
    starts += detector.push(voice(0.05)) === "start" ? 1 : 0;
  }

  // One duck when it starts, which the recognizer finds no words in, and then silence.
  assert.equal(starts, 1);
  assert.equal(detector.isSpeaking, false);
});

// One frame of a pure tone, the way the recorder hands audio over: 20ms of Int16.
function tone(hertz, sampleRate = 48_000, amplitude = 0.3) {
  const samples = new Int16Array(Math.round((sampleRate * 20) / 1000));

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * hertz * index) / sampleRate) * amplitude * 0x7fff;
  }

  return samples;
}

// The filters carry state across frames, so a few frames in is where a steady tone settles.
function settled(analyser, samples) {
  let levels;

  for (let index = 0; index < 5; index += 1) {
    levels = analyser.measure(samples);
  }

  return levels;
}

test("the analyser puts a voice, a lorry and a turned page in different bands", () => {
  const speech = settled(new SpeechBandAnalyser(48_000), tone(1_000));
  const traffic = settled(new SpeechBandAnalyser(48_000), tone(120));
  const paper = settled(new SpeechBandAnalyser(48_000), tone(8_000));

  assert.ok(speech.voice > speech.rumble, "1 kHz belongs to the voice, not the floor");
  assert.ok(speech.voice > speech.hiss, "1 kHz belongs to the voice, not the hiss");
  assert.ok(traffic.rumble > traffic.voice * 2, "120 Hz is the room, not a person");
  assert.ok(paper.hiss > paper.voice * 2, "8 kHz is paper, not a person");
});

test("the bands land in the same place whatever rate the hardware runs at", () => {
  // 48 kHz on a laptop, 16 kHz on a phone with a Bluetooth headset. The filters have to
  // hold their cutoffs at both, or a turned page at 16 kHz reads as somebody talking.
  for (const sampleRate of [16_000, 22_050, 44_100, 48_000]) {
    const speech = settled(new SpeechBandAnalyser(sampleRate), tone(1_000, sampleRate));
    const paper = settled(new SpeechBandAnalyser(sampleRate), tone(6_000, sampleRate));

    assert.ok(speech.voice > speech.hiss * 4, `1 kHz is a voice at ${sampleRate} Hz`);
    assert.ok(paper.hiss > paper.voice * 4, `6 kHz is not, at ${sampleRate} Hz`);
  }
});

test("the analyser and the detector agree about what a voice is", () => {
  // The two halves are only useful together: what one measures, the other judges.
  const speak = new SpeechBandAnalyser(48_000);
  const speaking = new VoiceActivityDetector();
  let started = false;

  for (let index = 0; index < 20; index += 1) {
    started ||= speaking.push(speak.measure(tone(1_000))) === "start";
  }

  assert.ok(started, "a tone in the middle of the voice band should read as speech");

  for (const hertz of [120, 8_000]) {
    const analyser = new SpeechBandAnalyser(48_000);
    const detector = new VoiceActivityDetector();

    for (let index = 0; index < 20; index += 1) {
      assert.equal(detector.push(analyser.measure(tone(hertz))), null, `${hertz} Hz is not speech`);
    }
  }
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
