import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { resolveRange } from "../src/lib/admin/ranges.ts";
import { creatorRevenue, promoCodeStats } from "../src/lib/admin/sales-math.ts";
import { codeCreditForTransaction } from "../src/lib/mobile/code-credit.ts";

const purchase = {
  productId: "eu.memoai.premium.yearly", transactionId: "2000000001", originalTransactionId: "2000000001",
  purchaseDate: Date.UTC(2026, 7, 18, 10), price: 64990, currency: "EUR", offerType: 1, transactionReason: "PURCHASE",
};

test("only a coded first charge on a regular product earns creator credit", () => {
  assert.deepEqual(codeCreditForTransaction(purchase), {
    original_transaction_id: "2000000001", transaction_id: "2000000001", product_id: "eu.memoai.premium.yearly",
    offer_type: 1, price_minor: 6499, currency: "eur", paid_at: "2026-08-18T10:00:00.000Z",
  });
  // A returning subscriber's server-signed promotional offer is also a code.
  assert.equal(codeCreditForTransaction({ ...purchase, offerType: 2, transactionId: "2000000009" }).offer_type, 2);
  assert.equal(codeCreditForTransaction({ ...purchase, transactionReason: "RENEWAL" }), null);
  assert.equal(codeCreditForTransaction({ ...purchase, offerType: undefined }), null, "full price is not a code");
  assert.equal(codeCreditForTransaction({ ...purchase, offerType: 3 }), null, "Apple offer codes are not ours");
  assert.equal(codeCreditForTransaction({ ...purchase, productId: "eu.memoai.premium.trial.yearly" }), null);
  assert.equal(codeCreditForTransaction({ ...purchase, price: 0 }), null, "a free period is not a sale");
  assert.equal(codeCreditForTransaction({ ...purchase, productId: "com.example.other" }), null);
});

test("the ledger credits one purchase per Apple subscription and outlives the account", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE ROLE anon; CREATE ROLE authenticated;
      INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000001');`);
    await db.exec(`BEGIN; ${readFileSync(new URL("../supabase/migrations/0055_apple_code_redemptions.sql", import.meta.url), "utf8")} COMMIT;`);
    const user = "00000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO apple_code_redemptions (user_id, code) VALUES ($1, 'MEMO50'), ($1, 'DAVID50')", [user]);
    await assert.rejects(db.query("INSERT INTO apple_code_redemptions (user_id, code) VALUES ($1, 'memo50')", [user]), /check/);
    // A paid row must say when it was paid.
    await assert.rejects(db.query("UPDATE apple_code_redemptions SET transaction_id = '1' WHERE code = 'MEMO50'"), /check/);
    const attach = (code, tx) => db.query(`UPDATE apple_code_redemptions SET original_transaction_id = '1', transaction_id = $2,
      price_minor = 6499, currency = 'eur', paid_at = now(), environment = 'sandbox' WHERE code = $1`, [code, tx]);
    await attach("MEMO50", "1");
    await assert.rejects(attach("DAVID50", "2"), /unique/, "a second code cannot claim the same subscription");
    await db.query("DELETE FROM auth.users");
    const rows = (await db.query("SELECT code, user_id, price_minor FROM apple_code_redemptions WHERE paid_at IS NOT NULL")).rows;
    assert.deepEqual(rows, [{ code: "MEMO50", user_id: null, price_minor: 6499 }]);
  } finally {
    await db.close();
  }
});

test("Apple code sales reach the creator who owns the code", () => {
  const range = resolveRange("7d", { now: new Date("2026-08-19T12:00:00Z") });
  const at = (iso) => Math.floor(Date.parse(iso) / 1000);
  const data = {
    subscriptions: [], customerCodes: new Map(), codeRedemptions: new Map(), truncated: false,
    promotionCodes: new Map([["promo_david", "DAVID50"]]),
    payments: [{ id: "in_1", paidAt: at("2026-08-18T09:00:00Z"), amount: 1000, currency: "eur", customerId: "cus_1", promotionCodeIds: ["promo_david"] }],
    appleCodeSales: [
      { id: "a1", code: "DAVID50", amount: 6499, currency: "eur", paidAt: at("2026-08-18T10:00:00Z") },
      { id: "a2", code: "DAVID50", amount: 999, currency: "eur", paidAt: at("2026-06-01T10:00:00Z") },
    ],
  };
  const stats = promoCodeStats(data, range);
  assert.equal(stats.get("DAVID50").revenue, 1000 + 6499, "the June sale is outside the range");
  assert.equal(stats.get("DAVID50").payments, 2);
  assert.equal(stats.get("DAVID50").customers, 2);
  assert.equal(stats.get("DAVID50").subscriptions, 2, "both Apple subscriptions were created with the code");
  const byCreator = creatorRevenue([{ id: "david", promo_codes: ["david50"] }], stats);
  assert.equal(byCreator.get("david").revenue, 7499);
});

test("a purchase owned by another Memo account says so instead of asking for a retry", async () => {
  const { nativeBillingFailureKey } = await import("../src/lib/mobile/billing-notice.ts");
  // The native bridge wraps the server's status in its error text.
  assert.equal(nativeBillingFailureKey(new Error("That did not work. [server 409: This Apple Account's subscription belongs to a different Memo account.]")), "native.otherAccount");
  assert.equal(nativeBillingFailureKey(new Error("That did not work. [server 503: Your purchase could not be confirmed yet.]")), "native.verifyFailed");
  assert.equal(nativeBillingFailureKey(new Error("That did not work.")), "native.verifyFailed");
  assert.equal(nativeBillingFailureKey("server 4090"), "native.verifyFailed");
  assert.equal(nativeBillingFailureKey(undefined), "native.verifyFailed");
});

test("the transactions route answers 409 only for another account's purchase", () => {
  const route = readFileSync(new URL("../src/app/api/mobile/transactions/route.ts", import.meta.url), "utf8");
  assert.match(route, /error instanceof AppleAccountMismatch[\s\S]{0,200}status: 409/);
  const apple = readFileSync(new URL("../src/lib/mobile/apple.ts", import.meta.url), "utf8");
  assert.match(apple, /appAccountToken\.toLowerCase\(\) !== userId\.toLowerCase\(\)\) \{\s*throw new AppleAccountMismatch/);
});
