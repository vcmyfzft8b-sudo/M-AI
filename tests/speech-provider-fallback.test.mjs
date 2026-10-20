import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AiProviderSpendCapError } from "../src/lib/ai/errors.ts";
import {
  BILLING_FALLBACK_MS,
  GeminiSpeechHealth,
  SERVER_FAILURE_WINDOW_MS,
  SERVER_FALLBACK_MS,
  classifyGeminiSpeechFailure,
  shouldSpeakWithSoniox,
} from "../src/lib/speech-provider-health.ts";

// Google's answer to every speech request on 2026-10-20 (MEMOAI-WEB-66 was the tutor's side of it).
const SPEND_CAP_BODY =
  '{"error":{"code":429,"message":"Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend to manage your project spend cap. Learn more at https://ai.google.dev/gemini-api/docs/billing#project-spend-caps. ","status":"RESOURCE_EXHAUSTED"}}';

/** The shape src/lib/gemini-tts.ts throws for a refused stream. */
const speechError = (status, detail) =>
  Object.assign(new Error(`Gemini speech refused (${status}): ${detail}`), { name: "GeminiSpeechError", status });

test("each way a Gemini speech request ends is told apart", () => {
  const cases = [
    // The tutor route sees the raw refusal; read-aloud and the podcast see it wrapped.
    [speechError(429, SPEND_CAP_BODY.slice(0, 300)), "billing"],
    [new AiProviderSpendCapError(SPEND_CAP_BODY), "billing"],
    [speechError(429, '{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}'), "busy"],
    // synthesizeGeminiMp3's rate-limit shape for read-aloud and the podcast.
    [Object.assign(new Error("Gemini speech rate limit: busy"), { statusCode: 429 }), "busy"],
    [speechError(503, "The model is overloaded."), "server"],
    [speechError(500, "Internal error"), "server"],
    [Object.assign(new TypeError("fetch failed")), "server"],
    [Object.assign(new Error("Gemini returned no audio."), { name: "GeminiSpeechError", status: null }), "no_audio"],
    [Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "timeout"],
    [speechError(400, "Invalid voice"), "other"],
    [new Error("something else"), "other"],
  ];

  for (const [error, expected] of cases) {
    assert.equal(classifyGeminiSpeechFailure(error), expected, error.message.slice(0, 60));
  }
});

test("only a refusal that will not clear by itself is spoken by Soniox", () => {
  assert.equal(shouldSpeakWithSoniox("billing"), true);
  assert.equal(shouldSpeakWithSoniox("server"), true);
  // An ordinary 429 stays Gemini's: the callers back off and Gemini answers a moment later.
  assert.equal(shouldSpeakWithSoniox("busy"), false);
  assert.equal(shouldSpeakWithSoniox("no_audio"), false);
  assert.equal(shouldSpeakWithSoniox("timeout"), false);
  assert.equal(shouldSpeakWithSoniox("other"), false);
});

function clock(start = Date.parse("2026-10-20T13:23:00Z")) {
  let now = start;
  return { now: () => now, advance: (ms) => (now += ms) };
}

test("one spend-cap refusal sends this instance's voices to Soniox for a while, then asks Gemini again", () => {
  const time = clock();
  const health = new GeminiSpeechHealth(time.now);

  assert.equal(health.isFallingBack(), false);
  health.record("billing");
  assert.equal(health.isFallingBack(), true);

  // A success in between does not cut the billing window short: the cap is still on.
  health.recordSuccess();
  time.advance(BILLING_FALLBACK_MS - 1);
  assert.equal(health.isFallingBack(), true);

  time.advance(1);
  assert.equal(health.isFallingBack(), false, "after the window the next request asks Gemini again");
});

test("a run of server failures falls back; scattered ones do not", () => {
  const time = clock();
  const health = new GeminiSpeechHealth(time.now);

  health.record("server");
  time.advance(SERVER_FAILURE_WINDOW_MS); // the first one has aged out
  health.record("server");
  health.record("server");
  assert.equal(health.isFallingBack(), false);

  health.recordSuccess(); // Gemini spoke, the run is over
  health.record("server");
  health.record("server");
  assert.equal(health.isFallingBack(), false);

  health.record("server");
  assert.equal(health.isFallingBack(), true);
  time.advance(SERVER_FALLBACK_MS);
  assert.equal(health.isFallingBack(), false);
});

test("busy, empty and timed-out answers never trip the fallback", () => {
  const health = new GeminiSpeechHealth(clock().now);

  for (let index = 0; index < 10; index += 1) {
    health.record("busy");
    health.record("no_audio");
    health.record("timeout");
    health.record("other");
  }

  assert.equal(health.isFallingBack(), false);
});

/*
 * The voice paths themselves are server-only. These pin the decisions that make the fallback
 * honest: TTS_PROVIDER=soniox still means Soniox and never asks Gemini, the cache key follows the
 * engine that actually spoke, and the tutor's Soniox audio arrives in the shape its player plays.
 */
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("TTS_PROVIDER=soniox still switches every voice, and a fallback never overrides it", () => {
  const source = read("src/lib/speech-synthesis.ts");

  assert.match(source, /env\.TTS_PROVIDER === "gemini" && env\.GEMINI_API_KEY \? "gemini" : "soniox"/);
  assert.match(source, /configured === "gemini" && geminiSpeechHealth\.isFallingBack\(\) \? "soniox" : configured/);
  assert.match(source, /return configuredSpeechProvider\(\) === "gemini" && shouldSpeakWithSoniox\(failure\);/);
});

test("the spend cap is not turned into a rate limit for read-aloud and the podcast", () => {
  const source = read("src/lib/speech-synthesis.ts");
  const fallback = source.indexOf("throw new GeminiSpeechUnavailableError(lastError)");
  const rateLimit = source.indexOf("Gemini speech rate limit:");

  assert.ok(fallback > 0 && fallback < rateLimit, "the fallback is decided before the 429 is reshaped");
});

test("read-aloud and the podcast store fallback audio under Soniox's model", () => {
  const noteTts = read("src/lib/note-tts.ts");
  const podcast = read("src/lib/podcast.ts");

  assert.match(
    noteTts,
    /if \(provider === "gemini" && error instanceof GeminiSpeechUnavailableError\) \{\s*return getOrCreateTtsChunk\(\{ \.\.\.params, provider: "soniox" \}\);/,
  );
  assert.doesNotMatch(noteTts, /model: speechModel\(\),\s*audio_storage_path/, "the row is keyed by the engine that spoke");
  assert.match(podcast, /model = speechModelFor\("soniox"\);\s*return synthesize\("soniox"\);/);
});

test("the tutor's Soniox fallback speaks the same PCM at the same rate", () => {
  const route = read("src/app/api/tutor/speech/route.ts");

  assert.match(route, /if \(request\.signal\.aborted \|\| !noteGeminiSpeechResult\(error\)\) \{\s*throw error;/);
  assert.match(route, /startSonioxSpeech\(\{[\s\S]*?sampleRate: GEMINI_TTS_SAMPLE_RATE,/);
  assert.match(route, /"X-Speech-Sample-Rate": String\(GEMINI_TTS_SAMPLE_RATE\)/);
  assert.match(read("src/lib/soniox-speech-stream.ts"), /audio_format: "pcm_s16le",\s*sample_rate: params\.sampleRate,/);
});
