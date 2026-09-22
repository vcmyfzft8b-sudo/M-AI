#!/usr/bin/env node
/**
 * Prints a Sign in with Apple client secret for the WEB flow (Supabase's
 * Apple provider), signed with the Memo Sign in with Apple key.
 *
 *   node scripts/apple/web-client-secret.mjs <services-id> [path/to/AuthKey_DG2SJQMW8J.p8]
 *
 * The secret is a JWT Apple accepts for at most six months; paste it into
 * Supabase → Authentication → Providers → Apple → "Secret Key (for OAuth)",
 * and note the expiry printed here so it is rotated in time. Nothing is
 * written anywhere; the key never leaves this machine.
 */
import { readFileSync } from "node:fs";
import { SignJWT, importPKCS8 } from "jose";

const TEAM_ID = "J4PCHZ8P7T";
const KEY_ID = "DG2SJQMW8J";
const [servicesId, keyPath = `${process.env.HOME}/.config/memoai/apple/AuthKey_${KEY_ID}.p8`] = process.argv.slice(2);

if (!servicesId) {
  console.error("Usage: node scripts/apple/web-client-secret.mjs <services-id> [key.p8]");
  process.exit(1);
}

const key = await importPKCS8(readFileSync(keyPath, "utf8"), "ES256");
const issuedAt = Math.floor(Date.now() / 1000);
const expiresAt = issuedAt + 180 * 24 * 60 * 60 - 60; // Apple's ceiling is six months.
const secret = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: KEY_ID })
  .setIssuer(TEAM_ID)
  .setIssuedAt(issuedAt)
  .setExpirationTime(expiresAt)
  .setAudience("https://appleid.apple.com")
  .setSubject(servicesId)
  .sign(key);

console.error(`Client secret for ${servicesId}, expires ${new Date(expiresAt * 1000).toISOString()}`);
console.log(secret);
