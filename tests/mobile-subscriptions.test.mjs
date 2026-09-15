import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { Environment, SignedDataVerifier } from "@apple/app-store-server-library";
import { entitlementFromVerifiedTransaction } from "../src/lib/mobile/transaction.ts";
import { isNativeUserAgent, isAppleProduct } from "../src/lib/mobile/runtime.ts";

const now = Date.UTC(2026, 8, 15);
const userId = "00000000-0000-4000-8000-000000000001";
const expected = { bundleId: "eu.memoai.memo", environment: "Production", userId };
const transaction = {
  bundleId: expected.bundleId, environment: "Production", appAccountToken: userId,
  type: "Auto-Renewable Subscription", productId: "eu.memoai.premium.monthly",
  transactionId: "12345", originalTransactionId: "12340",
  purchaseDate: now - 1000, expiresDate: now + 1000, signedDate: now,
};

test("Apple entitlements expire and revoked/upgraded transactions cannot grant access", () => {
  assert.equal(entitlementFromVerifiedTransaction(transaction, expected, now).status, "active");
  assert.equal(entitlementFromVerifiedTransaction({ ...transaction, expiresDate: now }, expected, now).status, "expired");
  assert.equal(entitlementFromVerifiedTransaction({ ...transaction, revocationDate: now }, expected, now).status, "revoked");
  assert.equal(entitlementFromVerifiedTransaction({ ...transaction, isUpgraded: true }, expected, now).status, "revoked");
});

test("rejects cross-account, cross-environment, wrong-app, unknown-product and malformed transactions", () => {
  for (const changes of [
    { appAccountToken: "00000000-0000-4000-8000-000000000002" }, { appAccountToken: undefined },
    { bundleId: "other.app" }, { environment: "Sandbox" }, { productId: "__proto__" },
    { productId: "eu.memoai.fake" }, { type: "Consumable" }, { transactionId: "1,or(user_id.neq.0)" },
    { expiresDate: undefined }, { signedDate: now + 600_000 }, { purchaseDate: -1 },
    { inAppOwnershipType: "FAMILY_SHARED" }, { expiresDate: now - 2000 },
  ]) assert.throws(() => entitlementFromVerifiedTransaction({ ...transaction, ...changes }, expected, now));
});

test("sandbox grants require an explicitly sandbox verifier context", () => {
  const result = entitlementFromVerifiedTransaction({ ...transaction, environment: "Sandbox" }, { ...expected, environment: "Sandbox" }, now);
  assert.equal(result.environment, "sandbox");
});

test("the Apple SDK rejects unsigned and forged transaction payloads", async () => {
  const roots = JSON.parse(readFileSync(new URL("../src/lib/mobile/apple-roots.json", import.meta.url))).map(root => Buffer.from(root, "base64"));
  const verifier = new SignedDataVerifier(roots, true, Environment.PRODUCTION, expected.bundleId, 123456789);
  const encoded = Buffer.from(JSON.stringify(transaction)).toString("base64url");
  await assert.rejects(verifier.verifyAndDecodeTransaction(`eyJhbGciOiJub25lIn0.${encoded}.`));
  await assert.rejects(verifier.verifyAndDecodeTransaction(`eyJhbGciOiJFUzI1NiJ9.${encoded}.ZmFrZQ`));
});

test("native UA is narrowly identified, and product lookup ignores object prototype keys", () => {
  assert.equal(isNativeUserAgent("Mozilla/5.0 MemoAI-iOS/1.0"), true);
  for (const ua of [null, "iPhone Safari/605", "FakeMemoAI-iOS/1.0", "MemoAI-iOS/1.0bad"]) assert.equal(isNativeUserAgent(ua), false);
  assert.equal(isAppleProduct("constructor"), false);
  assert.equal(isAppleProduct("eu.memoai.premium.yearly"), true);
});
