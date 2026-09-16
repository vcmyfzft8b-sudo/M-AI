import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";

const issuer = "https://appleid.apple.com";
const appleKeys = createRemoteJWKSet(new URL(`${issuer}/auth/keys`));

export function appleSignInConfigured() {
  let host: string;
  try { host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname; } catch { return false; }
  const allowed = process.env.VERCEL_ENV === "production" ? ["zrcwmhuwwvguiekzmcdj.supabase.co"]
    : process.env.VERCEL_ENV === "preview" ? ["yviipoccwsndxyrhtcjm.supabase.co"]
    : ["yviipoccwsndxyrhtcjm.supabase.co", "localhost", "127.0.0.1"];
  if (!allowed.includes(host)) return false;
  return process.env.APPLE_SIGN_IN_ENABLED === "true" && Boolean(
    process.env.APPLE_SIGN_IN_KEY_ID && process.env.APPLE_SIGN_IN_TEAM_ID && process.env.APPLE_SIGN_IN_PRIVATE_KEY
    && /^[0-9a-f]{64}$/i.test(process.env.APPLE_AUTH_TOKEN_ENCRYPTION_KEY ?? ""),
  );
}

export function nativeAppleClientID() { return process.env.APPLE_BUNDLE_ID || "eu.memoai.memo"; }

export async function verifyAppleIdentity(token: string, nonce: string, clientId = nativeAppleClientID(), keys: JWTVerifyGetKey = appleKeys) {
  const { payload } = await jwtVerify(token, keys, { issuer, audience: clientId, algorithms: ["RS256"], maxTokenAge: "10m" });
  const expected = createHash("sha256").update(nonce).digest("hex");
  if (!payload.sub || payload.nonce !== expected) throw new Error("Apple identity mismatch");
  return payload;
}

async function clientSecret(clientId: string) {
  const key = await importPKCS8((process.env.APPLE_SIGN_IN_PRIVATE_KEY || "").replace(/\\n/g, "\n"), "ES256");
  return new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: process.env.APPLE_SIGN_IN_KEY_ID })
    .setIssuer(process.env.APPLE_SIGN_IN_TEAM_ID!).setAudience(issuer).setSubject(clientId)
    .setIssuedAt().setExpirationTime("5m").sign(key);
}

export async function exchangeAppleCode(code: string, nonce: string, subject: string) {
  const clientId = nativeAppleClientID();
  const response = await fetch(`${issuer}/auth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: await clientSecret(clientId), code, grant_type: "authorization_code" }),
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Apple authorization exchange failed");
  const data = await response.json() as { id_token?: string; refresh_token?: string };
  if (!data.id_token || !data.refresh_token) throw new Error("Apple authorization incomplete");
  const verified = await verifyAppleIdentity(data.id_token, nonce);
  if (verified.sub !== subject) throw new Error("Apple authorization subject mismatch");
  return data.refresh_token;
}

export async function revokeAppleToken(token: string, clientId: string) {
  const response = await fetch(`${issuer}/auth/revoke`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: await clientSecret(clientId), token, token_type_hint: "refresh_token" }),
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Apple authorization revocation failed");
}

// Tokens never enter user_metadata, JWTs, browser storage, logs or plain database
// columns. Authentication binds each ciphertext to its owner and OAuth client.
function encryptionKey() {
  const value = process.env.APPLE_AUTH_TOKEN_ENCRYPTION_KEY || "";
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("Apple token encryption not configured");
  return Buffer.from(value, "hex");
}
export function sealAppleToken(token: string, userId: string, clientId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${userId}:${clientId}`));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function openAppleToken(value: string, userId: string, clientId: string) {
  const [version, iv, tag, data, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data || extra) throw new Error("Invalid Apple token envelope");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(`${userId}:${clientId}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
