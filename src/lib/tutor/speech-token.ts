// Kept free of "server-only" and of `@/` imports so the token contract is unit-testable
// (tests/tutor-speech-token.test.mjs) outside the Next.js runtime.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The tutor's ticket to speak.
 *
 * Soniox let the browser open its own speech socket with a temporary key that could do nothing
 * else and expired with the learner's slice of time. Gemini has no such key for speech, so the
 * browser asks our `/api/tutor/speech` route instead, and this token is what the Soniox key used
 * to be: minted with the slice, naming the learner and the lecture, and dead when the slice is.
 * It is checked with a hash rather than a database round trip because it is presented once per
 * sentence, and the time a lookup takes is time the learner spends waiting for the next one.
 */
export type TutorSpeechClaims = {
  userId: string;
  lectureId: string;
  /** Unix seconds. */
  expiresAt: number;
};

/** Derived from the service-role key, the way the impersonation cookies are: nothing new to set. */
export function tutorSpeechTokenSecret(serviceRoleKey: string) {
  return createHash("sha256").update("memoai-tutor-speech-token-v1:").update(serviceRoleKey).digest();
}

export function signTutorSpeechToken(claims: TutorSpeechClaims, secret: Buffer | string) {
  const body = Buffer.from(
    JSON.stringify({ u: claims.userId, l: claims.lectureId, e: claims.expiresAt }),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");

  return `${body}.${signature}`;
}

/** The claims, or null when the token is forged, malformed or past its slice. */
export function verifyTutorSpeechToken(
  token: string | null | undefined,
  secret: Buffer | string,
  nowSeconds = Math.floor(Date.now() / 1000),
): TutorSpeechClaims | null {
  if (!token) {
    return null;
  }

  const separator = token.lastIndexOf(".");

  if (separator <= 0) {
    return null;
  }

  const body = token.slice(0, separator);
  const provided = Buffer.from(token.slice(separator + 1), "base64url");
  const expected = createHmac("sha256", secret).update(body).digest();

  // Length first: timingSafeEqual throws on a mismatch rather than returning false.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  const { u, l, e } = parsed;

  if (
    typeof u !== "string" ||
    typeof l !== "string" ||
    typeof e !== "number" ||
    e <= nowSeconds
  ) {
    return null;
  }

  return { userId: u, lectureId: l, expiresAt: e };
}
