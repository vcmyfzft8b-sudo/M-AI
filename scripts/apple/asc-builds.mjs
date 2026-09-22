#!/usr/bin/env node
/** Lists the app's builds and their processing state from the App Store Connect API.
 *  node scripts/apple/asc-builds.mjs   (uses the Admin key in ~/.config/memoai/apple) */
import { readFileSync } from "node:fs";
import { SignJWT, importPKCS8 } from "jose";
const KEY_ID = process.env.ASC_KEY_ID || "M2VD53GP68";
const ISSUER = process.env.ASC_ISSUER_ID || "6715f045-a181-4ad1-b072-5824a5bf1220";
const APP = "6812409212";
const key = await importPKCS8(readFileSync(`${process.env.HOME}/.config/memoai/apple/AuthKey_${KEY_ID}.p8`, "utf8"), "ES256");
const token = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: KEY_ID, typ: "JWT" })
  .setIssuer(ISSUER).setIssuedAt().setExpirationTime("15m").setAudience("appstoreconnect-v1").sign(key);
const url = process.argv[2] || `https://api.appstoreconnect.apple.com/v1/builds?filter[app]=${APP}&sort=-uploadedDate&limit=5&fields[builds]=version,uploadedDate,processingState,expired,usesNonExemptEncryption`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
const body = await res.json();
if (!res.ok) { console.error(res.status, JSON.stringify(body)); process.exit(1); }
for (const b of body.data ?? []) console.log(b.id, b.attributes.version, b.attributes.processingState, b.attributes.uploadedDate, "encryption:", b.attributes.usesNonExemptEncryption);
if (!body.data?.length) console.log("no builds listed yet");
