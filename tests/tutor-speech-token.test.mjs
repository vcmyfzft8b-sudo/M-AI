import assert from "node:assert/strict";
import test from "node:test";

import {
  signTutorSpeechToken,
  tutorSpeechTokenSecret,
  verifyTutorSpeechToken,
} from "../src/lib/tutor/speech-token.ts";

// The speech route spends our Gemini key on the strength of this token alone, so it has to be
// exactly as hard to forge and exactly as short-lived as the Soniox key it replaced.

const secret = tutorSpeechTokenSecret("service-role-key");
const now = 1_800_000_000;
const claims = { userId: "user-1", lectureId: "lecture-1", expiresAt: now + 1800 };

test("a token minted for a slice is accepted for that slice", () => {
  assert.deepEqual(verifyTutorSpeechToken(signTutorSpeechToken(claims, secret), secret, now), claims);
});

test("it dies with the slice, as the Soniox key did", () => {
  const token = signTutorSpeechToken(claims, secret);

  assert.equal(verifyTutorSpeechToken(token, secret, now + 1800), null);
  assert.equal(verifyTutorSpeechToken(token, secret, now + 4000), null);
});

test("a token with its body changed is refused", () => {
  const token = signTutorSpeechToken(claims, secret);
  const [, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "user-1", l: "lecture-1", e: now + 999_999 })).toString("base64url");

  assert.equal(verifyTutorSpeechToken(`${forged}.${signature}`, secret, now), null);
});

test("a token signed with another key is refused", () => {
  const token = signTutorSpeechToken(claims, tutorSpeechTokenSecret("another-key"));

  assert.equal(verifyTutorSpeechToken(token, secret, now), null);
});

test("garbage is refused rather than thrown on", () => {
  for (const value of [null, undefined, "", "abc", ".", "a.b", "e30.", `${"x".repeat(20)}.${"y".repeat(43)}`]) {
    assert.equal(verifyTutorSpeechToken(value, secret, now), null, String(value));
  }
});
