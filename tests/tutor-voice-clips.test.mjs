import assert from "node:assert/strict";
import test from "node:test";

import { hasStaticVoiceSamples, voiceSampleClip } from "../src/lib/tutor/voice-clips.ts";

test("a language with pre-rendered clips plays the file", () => {
  for (const language of ["sl", "en", "hr", "sr", "bs", "de", "it"]) {
    assert.equal(hasStaticVoiceSamples(language), true, language);
    assert.equal(voiceSampleClip("Grace", language), `/tutor-demo/${language}/grace-sample.mp3`);
  }
});

test("a language without them is synthesized rather than auditioned in English", () => {
  /*
   * The old behaviour fell back to the English clip, which auditions the wrong thing entirely:
   * accent and cadence are what differ between a voice's languages, so a Polish learner heard
   * nothing about the voice that was going to teach them.
   */
  assert.equal(hasStaticVoiceSamples("pl"), false);
  assert.equal(
    voiceSampleClip("Grace", "pl"),
    "/api/tutor/voice-sample?voice=Grace&language=pl",
  );
});

test("a voice or language that could carry a query string cannot break the URL", () => {
  const url = voiceSampleClip("Gra&ce", "pl?x=1");

  assert.equal(url, "/api/tutor/voice-sample?voice=Gra%26ce&language=pl%3Fx%3D1");
});
