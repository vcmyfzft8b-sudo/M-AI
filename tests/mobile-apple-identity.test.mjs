import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { verifyAppleIdentity, sealAppleToken, openAppleToken } from "../src/lib/mobile/apple-identity.ts";

test("Apple identity verification rejects nonce, audience, issuer and expired/replayed credentials", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const nonce = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(nonce).digest("hex");
  const sign = ({ audience = "eu.memoai.memo", issuer = "https://appleid.apple.com", issued = Math.floor(Date.now() / 1000), expiry = "5m", tokenNonce = hash } = {}) =>
    new SignJWT({ nonce: tokenNonce }).setProtectedHeader({ alg: "RS256" }).setIssuer(issuer)
      .setAudience(audience).setSubject("synthetic-apple-subject").setIssuedAt(issued).setExpirationTime(expiry).sign(privateKey);
  const verify = token => verifyAppleIdentity(token, nonce, "eu.memoai.memo", async () => publicKey);
  assert.equal((await verify(await sign())).sub, "synthetic-apple-subject");
  for (const invalid of [
    { audience: "other.app" }, { issuer: "https://attacker.invalid" }, { tokenNonce: "wrong" },
    { issued: Math.floor(Date.now() / 1000) - 700 }, { expiry: Math.floor(Date.now() / 1000) - 1 },
  ]) await assert.rejects(verify(await sign(invalid)));
});

test("stored Apple refresh tokens are authenticated and bound to the owner and client", () => {
  const previous = process.env.APPLE_AUTH_TOKEN_ENCRYPTION_KEY;
  process.env.APPLE_AUTH_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  try {
    const token = "synthetic-refresh-token";
    const sealed = sealAppleToken(token, "user-a", "memo");
    assert.equal(sealed.includes(token), false);
    assert.notEqual(sealed, sealAppleToken(token, "user-a", "memo"));
    assert.equal(openAppleToken(sealed, "user-a", "memo"), token);
    assert.throws(() => openAppleToken(sealed, "user-b", "memo"));
    assert.throws(() => openAppleToken(sealed, "user-a", "other-client"));
    const parts = sealed.split(".");
    const damaged = Buffer.from(parts[3], "base64url"); damaged[0] ^= 1;
    parts[3] = damaged.toString("base64url");
    assert.throws(() => openAppleToken(parts.join("."), "user-a", "memo"));
  } finally {
    if (previous === undefined) delete process.env.APPLE_AUTH_TOKEN_ENCRYPTION_KEY;
    else process.env.APPLE_AUTH_TOKEN_ENCRYPTION_KEY = previous;
  }
});
