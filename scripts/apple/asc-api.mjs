#!/usr/bin/env node
/** Minimal App Store Connect API call: node scripts/apple/asc-api.mjs GET /v1/... ['{"json":...}'] */
import { readFileSync } from "node:fs";
import { SignJWT, importPKCS8 } from "jose";
const KEY_ID = process.env.ASC_KEY_ID || "M2VD53GP68";
const ISSUER = process.env.ASC_ISSUER_ID || "6715f045-a181-4ad1-b072-5824a5bf1220";
const [method = "GET", path = "/v1/apps", body] = process.argv.slice(2);
const key = await importPKCS8(readFileSync(`${process.env.HOME}/.config/memoai/apple/AuthKey_${KEY_ID}.p8`, "utf8"), "ES256");
const token = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: KEY_ID, typ: "JWT" })
  .setIssuer(ISSUER).setIssuedAt().setExpirationTime("15m").setAudience("appstoreconnect-v1").sign(key);
const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
  method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body,
});
const text = await res.text();
console.log(res.status, text.slice(0, 4000));
if (!res.ok) process.exit(1);
