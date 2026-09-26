// The App Store tutor hour: a consumable that must be credited exactly once,
// never lost after Apple has charged, and never treated as a subscription.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function load(path, modules) {
  const source = ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, console, Number, Math, Error, Promise, JSON,
    require: (name) => { if (!(name in modules)) throw new Error(`Unstubbed import ${name}`); return modules[name]; } };
  vm.runInNewContext(source, context);
  return context.exports;
}

function ledger({ creditFails = false } = {}) {
  const rows = new Map();
  const credited = [];
  const supabase = {
    from: () => ({
      insert: async (row) => {
        if (rows.has(row.stripe_checkout_session_id)) return { error: { code: "23505" } };
        rows.set(row.stripe_checkout_session_id, row);
        return { error: null };
      },
      delete: () => ({ eq: async (_column, key) => { rows.delete(key); return { error: null }; } }),
    }),
  };
  const credits = load("lib/tutor-credits.ts", {
    "server-only": {},
    "@/lib/server-env": { getServerEnv: () => ({}) },
    "@/lib/supabase/server": { createSupabaseServiceRoleClient: () => supabase },
    "@/lib/tutor-usage": {
      TUTOR_CREDIT_PACK_SECONDS: 3600,
      creditTutorSeconds: async ({ userId, seconds }) => {
        if (creditFails) throw new Error("rpc down");
        credited.push([userId, seconds]);
      },
    },
  });
  return { credits, rows, credited };
}

const purchase = { userId: "00000000-0000-4000-8000-000000000001", transactionId: "2000000999", amountMinor: 199, currency: "eur" };

test("an App Store hour is credited once, however often it is delivered", async () => {
  const { credits, rows, credited } = ledger();
  assert.equal(JSON.stringify(await credits.creditAppleTutorPurchase(purchase)), JSON.stringify({ credited: true }));
  // Transaction.updates, a restore and a retried delivery all replay it.
  assert.equal(JSON.stringify(await credits.creditAppleTutorPurchase(purchase)), JSON.stringify({ credited: false }));
  assert.deepEqual(credited, [[purchase.userId, 3600]]);
  assert.deepEqual([...rows.keys()], ["apple:2000000999"], "keyed apart from Stripe sessions");
  assert.equal(rows.get("apple:2000000999").amount_total, 199);
});

test("a failed credit releases its claim so the app's retry can still credit it", async () => {
  const failing = ledger({ creditFails: true });
  await assert.rejects(failing.credits.creditAppleTutorPurchase(purchase), /rpc down/);
  assert.equal(failing.rows.size, 0, "Apple has charged; the hour must not be lost to a half-written claim");
});

test("a server notification about a tutor hour is acknowledged, not treated as a subscription", () => {
  const apple = readFileSync(new URL("../src/lib/mobile/apple.ts", import.meta.url), "utf8");
  const save = apple.slice(apple.indexOf("export async function saveAppleTransaction"));
  assert.match(save, /if \(isAppleConsumable\(verified\.productId\)\) return null;/);
  assert.ok(save.indexOf("isAppleConsumable") < save.indexOf("entitlementFromVerifiedTransaction"),
    "the consumable check must come before the subscription validation that would throw");
});

test("the app never sees Stripe for tutor time, and subscribers alone may open Apple's sheet", () => {
  const web = readFileSync(new URL("../src/app/api/billing/tutor-credits/route.ts", import.meta.url), "utf8");
  assert.match(web, /isNativeUserAgent[\s\S]{0,120}native_purchase_required/);
  const mobile = readFileSync(new URL("../src/app/api/mobile/tutor-credits/route.ts", import.meta.url), "utf8");
  assert.match(mobile, /canPurchase: appleBillingConfigured\(\) && state\.hasPaidAccess/);
  const sheet = readFileSync(new URL("../src/components/voice-usage-sheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /nativeRequest<\{ status: string \}>\("purchaseTutorHour"/);
  assert.doesNotMatch(sheet.slice(sheet.indexOf("buyAppleHour")), /checkout\.stripe|\/api\/billing\/tutor-credits/);
});

test("a subscriber can find the top-up before their day runs out, on the web and in the app", () => {
  // App Review has to be able to reach every purchase it reviews, and nobody
  // spends the whole daily half hour just to look for it.
  const sheet = readFileSync(new URL("../src/components/voice-usage-sheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const canTopUp = Boolean\(usage\?\.hasPaidAccess && !usage\.hasUnlimitedUsage\)/);
  assert.match(sheet, /\{\(isSpent \|\| canTopUp\) && !\(native && usage\.hasPaidAccess && !appleHour\)/);
  assert.match(sheet, /const wantsAppleHour = Boolean\(native && usage\?\.hasPaidAccess && \(!usage\.hasUnlimitedUsage \|\| blocked\)\)/);
  // Before the day is spent the offer says so, rather than "that's it for today".
  assert.match(sheet, /usage\?\.hasPaidAccess && !isSpent\s*\?\s*"tutor\.paywall\.moreTitle"/);
  assert.match(sheet, /native \? "native\.tutorHourMoreBody" : "tutor\.paywall\.moreBody"/);
});
