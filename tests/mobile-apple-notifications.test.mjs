// Apple delivers Sandbox notifications — its own connectivity test, and every TestFlight and App
// Review purchase event — to the PRODUCTION server URL. On 18 September 2026 production answered
// them 503, because reading a sandbox payload was gated on APPLE_SANDBOX_REVIEW_USER_IDS, an
// allowlist about which accounts may hold a sandbox entitlement. Apple resends a non-200 at 1, 12,
// 24, 48 and 72 hours, so one test notification spent the day on the error-rate chart, and the
// route's bare `catch` meant nothing anywhere said why.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import { Environment, VerificationException, VerificationStatus } from "@apple/app-store-server-library";

function transpile(path) {
  return ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}

function run(source, modules) {
  const context = {
    exports: {}, console, URL, Date, Set, Buffer, Number, JSON, Error, Promise,
    process: { env: modules.env ?? {} },
    require: name => { if (!(name in modules)) throw new Error(`Unstubbed import ${name}`); return modules[name]; },
  };
  vm.runInNewContext(source, context);
  return context.exports;
}

/**
 * Loads the real src/lib/mobile/apple.ts with only its I/O replaced: Apple's verifier becomes a
 * recorder whose verdict each test dictates, so what is under test is our own decision about
 * which verifier to try and what a failure means.
 */
function loadApple({ vercelEnv = "production", verdicts, db }) {
  const constructed = [];
  class SignedDataVerifier {
    constructor(_roots, _online, environment, bundleId, appAppleId) {
      this.environment = environment;
      constructed.push({ environment, bundleId, appAppleId });
    }
    async verifyAndDecodeNotification(jws) {
      const verdict = verdicts[this.environment];
      if (verdict instanceof Error) throw verdict;
      return { ...verdict, jws };
    }
    async verifyAndDecodeTransaction(jws) {
      const verdict = verdicts[this.environment];
      if (verdict instanceof Error) throw verdict;
      return { ...verdict, jws };
    }
  }
  const env = {
    VERCEL_ENV: vercelEnv,
    NEXT_PUBLIC_SUPABASE_URL: vercelEnv === "production"
      ? "https://zrcwmhuwwvguiekzmcdj.supabase.co" : "https://yviipoccwsndxyrhtcjm.supabase.co",
    APPLE_BUNDLE_ID: "eu.memoai.memo", APPLE_APP_ID: "6812409212",
    APPLE_IAP_PRIVATE_KEY: "key", APPLE_IAP_KEY_ID: "kid", APPLE_IAP_ISSUER_ID: "iss",
  };
  const exports = run(transpile("lib/mobile/apple.ts"), {
    env,
    "server-only": {},
    "@apple/app-store-server-library": {
      AppStoreServerAPIClient: class {}, Environment, SignedDataVerifier, VerificationException, VerificationStatus,
    },
    "@/lib/supabase/server": { createSupabaseServiceRoleClient: () => { if (!db) throw new Error("no database in this test"); return db.client; } },
    "@/lib/mobile/transaction": { entitlementFromVerifiedTransaction: (tx, expected) => {
      if (expected.userId && tx.appAccountToken !== expected.userId) throw new Error("Invalid Apple entitlement");
      return { plan: "monthly", user_id: tx.appAccountToken, product_id: tx.productId, transaction_id: "2",
        original_transaction_id: tx.originalTransactionId, environment: "sandbox", purchased_at: "2026-09-28T00:00:00.000Z" };
    } },
    "@/lib/mobile/code-attribution": { attributeAppleCodePurchase: async (_tx, row) => { db?.attributed.push(row.user_id); } },
    "@/lib/mobile/runtime": { isAppleConsumable: (value) => value === "eu.memoai.tutor.hour" },
    "@/lib/mobile/apple-roots.json": { default: ["cm9vdA=="] },
  });
  return { ...exports, constructed };
}

/**
 * A database with the accounts that exist and the entitlement rows there are: enough for
 * saveAppleTransaction's ownership decisions, which are what these tests are about.
 */
function fakeDatabase({ users = [], rows = [] } = {}) {
  const db = { rows, attributed: [], client: null };
  db.client = {
    auth: { admin: { getUserById: async (id) => users.includes(id)
      ? { data: { user: { id } }, error: null }
      : { data: { user: null }, error: { status: 404, code: "user_not_found" } } } },
    from(table) {
      let op = "select";
      const filters = {};
      const query = {
        select() { return query; }, is() { return query; }, or() { return query; }, limit() { return query; },
        single() { return query; }, maybeSingle() { return query; },
        eq(column, value) { filters[column] = value; return query; },
        neq(column, value) { filters[column] = { not: value }; return query; },
        update() { op = "update"; return query; },
        upsert(value) {
          op = "upsert";
          if (table === "mobile_app_store_entitlements" && !rows.some((row) =>
            row.original_transaction_id === value.original_transaction_id && row.product_id === value.product_id)) rows.push({ ...value });
          return query;
        },
        then(resolve, reject) {
          const data = op === "select" && table === "mobile_app_store_entitlements"
            ? rows.find((row) => Object.entries(filters).every(([key, value]) =>
              value && typeof value === "object" ? row[key] !== value.not : row[key] === value)) ?? null
            : null;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return db;
}

const TEST_NOTIFICATION = { notificationType: "TEST", data: { bundleId: "eu.memoai.memo", environment: "Sandbox" } };
const wrongEnvironment = () => new VerificationException(VerificationStatus.INVALID_ENVIRONMENT);

// The regression. Apple's sandbox test notification reached production on 18 September with the
// allowlist not yet deployed, and the decode was refused because of it.
test("production reads a sandbox notification", async () => {
  const apple = loadApple({
    verdicts: { [Environment.PRODUCTION]: wrongEnvironment(), [Environment.SANDBOX]: TEST_NOTIFICATION },
  });
  const notification = await apple.verifyAppleNotification("ey.sandbox");
  assert.equal(notification.notificationType, "TEST");
  assert.deepEqual(apple.constructed.map(v => v.environment), [Environment.PRODUCTION, Environment.SANDBOX]);
});

test("a production notification never reaches the sandbox verifier", async () => {
  const apple = loadApple({
    verdicts: { [Environment.PRODUCTION]: { notificationType: "DID_RENEW" }, [Environment.SANDBOX]: wrongEnvironment() },
  });
  assert.equal((await apple.verifyAppleNotification("ey.production")).notificationType, "DID_RENEW");
  assert.deepEqual(apple.constructed.map(v => v.environment), [Environment.PRODUCTION]);
});

// Outside production the first verifier is already the sandbox one; a second pass would only
// repeat it, and a preview must never silently accept a production payload.
test("a preview does not retry a failed notification against another environment", async () => {
  const apple = loadApple({
    vercelEnv: "preview",
    verdicts: { [Environment.SANDBOX]: wrongEnvironment(), [Environment.PRODUCTION]: TEST_NOTIFICATION },
  });
  await assert.rejects(apple.verifyAppleNotification("ey.production"),
    error => error instanceof VerificationException && error.status === VerificationStatus.INVALID_ENVIRONMENT);
  assert.deepEqual(apple.constructed.map(v => v.environment), [Environment.SANDBOX]);
});

test("the production verifier carries the app id and the sandbox one does not", async () => {
  const apple = loadApple({
    verdicts: { [Environment.PRODUCTION]: wrongEnvironment(), [Environment.SANDBOX]: TEST_NOTIFICATION },
  });
  await apple.verifyAppleNotification("ey.sandbox");
  assert.deepEqual(apple.constructed, [
    { environment: Environment.PRODUCTION, bundleId: "eu.memoai.memo", appAppleId: 6812409212 },
    { environment: Environment.SANDBOX, bundleId: "eu.memoai.memo", appAppleId: undefined },
  ]);
});

// Whether to ask Apple to send it again. Wrong on the permanent side costs three days of 5xx;
// wrong on the acknowledged side loses a purchase, so anything unrecognised must stay retryable.
test("a payload that belongs to somebody else is not worth another attempt", () => {
  const apple = loadApple({ verdicts: {} });
  for (const status of ["INVALID_APP_IDENTIFIER", "INVALID_ENVIRONMENT", "INVALID_CHAIN_LENGTH"]) {
    assert.equal(apple.appleNotificationRetryable(new VerificationException(VerificationStatus[status])), false, status);
  }
  assert.equal(apple.appleNotificationRetryable(new apple.AppleNotificationRejected("Sandbox account not allowed")), false);
});

// The statuses the library reuses for our own side of the exchange. An unrotated pinned root makes
// every notification a VERIFICATION_FAILURE and a stale OCSP response makes every one a FAILURE;
// acknowledging those would discard real billing notifications during an outage we could recover
// from, so they keep the retry even though a forged payload also lands here.
test("a failure that could be ours, and anything unrecognised, is retryable", () => {
  const apple = loadApple({ verdicts: {} });
  for (const status of ["VERIFICATION_FAILURE", "FAILURE", "RETRYABLE_VERIFICATION_FAILURE", "INVALID_CERTIFICATE"]) {
    assert.equal(apple.appleNotificationRetryable(new VerificationException(VerificationStatus[status])), true, status);
  }
  assert.equal(apple.appleNotificationRetryable(new Error("Apple entitlement insert failed")), true);
  assert.equal(apple.appleNotificationRetryable(undefined), true);
});

/** Loads the real notification route with the Apple library and Sentry replaced by recorders. */
function loadRoute({ enabled = "true", verify, save } = {}) {
  const calls = { verified: [], saved: [], routeErrors: [], backgroundErrors: [] };
  class NextResponse extends Response {
    static json(data, init) { return new NextResponse(JSON.stringify(data), init); }
  }
  class AppleNotificationRejected extends Error {}
  const exports = run(transpile("app/api/mobile/notifications/route.ts"), {
    env: { APPLE_IAP_ENABLED: enabled },
    zod: { z }, "next/server": { NextResponse },
    "@/lib/mobile/apple": {
      AppleNotificationRejected,
      verifyAppleNotification: async jws => { calls.verified.push(jws); if (verify instanceof Error) throw verify; return verify; },
      saveAppleTransaction: async jws => {
        calls.saved.push(jws);
        if (save === "reject") throw new AppleNotificationRejected("Sandbox account not allowed");
        if (save instanceof Error) throw save;
      },
      appleNotificationRetryable: error => !(error instanceof AppleNotificationRejected),
    },
    "@/lib/monitoring": {
      captureRouteError: (error, context) => calls.routeErrors.push([error, context]),
      captureBackgroundError: (error, context) => calls.backgroundErrors.push([error, context]),
    },
    "@/lib/request-validation": {
      parseJsonRequest: async request => ({ success: true, data: await request.json() }),
    },
  });
  return {
    calls,
    post: (signedPayload = "ey.payload") => exports.POST(new Request("https://www.memoai.eu/api/mobile/notifications", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedPayload }),
    })),
  };
}

test("a notification Apple could usefully resend is answered 503 and reported", async () => {
  const route = loadRoute({ verify: new Error("OCSP responder unreachable") });
  const response = await route.post();
  assert.equal(response.status, 503);
  assert.equal(route.calls.routeErrors.length, 1);
  assert.equal(route.calls.routeErrors[0][1].operation, "apple_notification_retry");
  assert.deepEqual(route.calls.backgroundErrors, []);
});

// The three-day retry is the point: acknowledging a dead notification is what keeps it off the
// error-rate chart, and the report is what keeps it from being invisible instead.
test("a notification that will never be accepted is acknowledged, and still reported", async () => {
  const route = loadRoute({ verify: { data: { signedTransactionInfo: "ey.tx" } }, save: "reject" });
  const response = await route.post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, accepted: false });
  assert.deepEqual(route.calls.saved, ["ey.tx"]);
  assert.deepEqual(route.calls.routeErrors, []);
  assert.equal(route.calls.backgroundErrors.length, 1);
  assert.equal(route.calls.backgroundErrors[0][1].operation, "apple_notification_rejected");
});

test("no failure leaves the route without a report", async () => {
  for (const failure of [new Error("database down"), Object.assign(new Error("rejected"), {})]) {
    const route = loadRoute({ verify: failure });
    await route.post();
    assert.equal(route.calls.routeErrors.length + route.calls.backgroundErrors.length, 1, failure.message);
  }
});

test("a notification carrying a transaction is persisted before it is acknowledged", async () => {
  const route = loadRoute({ verify: { data: { signedTransactionInfo: "ey.transaction" } } });
  const response = await route.post("ey.renewal");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
  assert.deepEqual(route.calls.verified, ["ey.renewal"]);
  assert.deepEqual(route.calls.saved, ["ey.transaction"]);
});

test("a test notification carries no transaction and writes nothing", async () => {
  const route = loadRoute({ verify: { notificationType: "TEST", data: { bundleId: "eu.memoai.memo" } } });
  assert.equal((await route.post()).status, 200);
  assert.deepEqual(route.calls.saved, []);
});

test("with Apple billing off nothing is verified at all", async () => {
  const route = loadRoute({ enabled: "false", verify: {} });
  assert.equal((await route.post()).status, 503);
  assert.deepEqual(route.calls.verified, []);
});

// 23 September, TestFlight on production: an Apple ID that already held a purchase made for
// another Memo account got "could not be confirmed yet, try again" (503) forever, because the
// sandbox allowlist was checked before ownership. Ownership now answers first.
test("a sandbox purchase made for another Memo account is reported as such, not as retryable", async () => {
  const buyer = "0d3e5149-7b2c-4a1e-9f3d-2c8b6e5a4d10";
  const other = "11111111-2222-4333-8444-555555555555";
  const apple = loadApple({
    verdicts: { [Environment.PRODUCTION]: wrongEnvironment(), [Environment.SANDBOX]: { appAccountToken: other, productId: "eu.memoai.premium.yearly" } },
    db: fakeDatabase({ users: [buyer, other] }),
  });
  await assert.rejects(apple.saveAppleTransaction("ey.sandbox", buyer, true), (error) => error.name === "AppleAccountMismatch");
});

// 28 September: Restore on a TestFlight Apple ID answered "belongs to a different Memo account" for
// eight subscription transactions bought for two test accounts deleted since. Nothing ever finished
// them, so every restore and every launch repeated it. A purchase whose account is gone now moves
// to the account restoring it.
const deleted = "06ffecc9-0268-4ad1-aa4c-d0284bc3169b";
const restorer = "3f6c2a1e-8b4d-4c7e-9a2f-1d5e6b7c8a90";
const leftBehind = { appAccountToken: deleted, productId: "eu.memoai.premium.trial.yearly", originalTransactionId: "2000001240464328" };

test("a purchase whose Memo account was deleted moves to the account restoring it", async () => {
  const db = fakeDatabase({ users: [restorer] });
  const apple = loadApple({ verdicts: { [Environment.PRODUCTION]: wrongEnvironment(), [Environment.SANDBOX]: leftBehind }, db });
  const saved = await apple.saveAppleTransaction("ey.sandbox", restorer);
  assert.equal(saved.user_id, restorer);
  assert.deepEqual(db.rows.map((row) => row.user_id), [restorer]);
  assert.deepEqual(db.attributed, [], "no creator credit for a purchase the restorer did not make");
});

test("once taken over, it is not taken again by a third account", async () => {
  const third = "99999999-8888-4777-8666-555555555555";
  const db = fakeDatabase({ users: [restorer, third], rows: [{ ...leftBehind, user_id: restorer,
    original_transaction_id: leftBehind.originalTransactionId, product_id: leftBehind.productId, environment: "sandbox" }] });
  const apple = loadApple({ verdicts: { [Environment.PRODUCTION]: wrongEnvironment(), [Environment.SANDBOX]: leftBehind }, db });
  await assert.rejects(apple.saveAppleTransaction("ey.sandbox", third), (error) => error.name === "AppleAccountMismatch");
});

test("a renewal of a taken-over purchase follows its new owner; with no owner it is acknowledged", async () => {
  const owned = fakeDatabase({ users: [restorer], rows: [{ user_id: restorer, original_transaction_id: leftBehind.originalTransactionId,
    product_id: leftBehind.productId, environment: "sandbox" }] });
  const renewal = loadApple({ verdicts: { [Environment.PRODUCTION]: wrongEnvironment(), [Environment.SANDBOX]: leftBehind }, db: owned });
  assert.equal((await renewal.saveAppleTransaction("ey.sandbox")).user_id, restorer);

  const orphan = loadApple({ verdicts: { [Environment.PRODUCTION]: wrongEnvironment(), [Environment.SANDBOX]: leftBehind }, db: fakeDatabase() });
  assert.equal(await orphan.saveAppleTransaction("ey.sandbox"), null);
});

// 27 September: TestFlight purchases from any account but three allowlisted ones answered 503,
// so a device recording App Review asked for — a new account that subscribes — could not be made,
// and a reviewer who registered their own account would have met the same wall.
test("production accepts a TestFlight purchase from any account", async () => {
  const buyer = "3f6c2a1e-8b4d-4c7e-9a2f-1d5e6b7c8a90";
  const apple = loadApple({
    verdicts: { [Environment.PRODUCTION]: wrongEnvironment(), [Environment.SANDBOX]: { appAccountToken: buyer, productId: "eu.memoai.premium.monthly" } },
  });
  // Verification passes and the purchase goes on to be stored; the stub has no database.
  await assert.rejects(apple.saveAppleTransaction("ey.sandbox", buyer), /no database in this test/);
  assert.deepEqual(apple.constructed.map(v => v.environment).slice(0, 2), [Environment.PRODUCTION, Environment.SANDBOX]);
  assert.deepEqual([...apple.appleAccountEnvironments()], ["production", "sandbox"]);
});

test("a preview holds sandbox entitlements only", () => {
  const apple = loadApple({ vercelEnv: "preview", verdicts: {} });
  assert.deepEqual([...apple.appleAccountEnvironments()], ["sandbox"]);
});

// An OCSP or chain failure on a real purchase must surface as itself; read as sandbox it would
// come back INVALID_ENVIRONMENT, which the notification route treats as never worth a retry.
test("only a wrong-environment verdict sends a purchase to the sandbox verifier", async () => {
  const apple = loadApple({
    verdicts: { [Environment.PRODUCTION]: new VerificationException(VerificationStatus.FAILURE), [Environment.SANDBOX]: { appAccountToken: "x" } },
  });
  await assert.rejects(apple.saveAppleTransaction("ey.production", "x"),
    error => error instanceof VerificationException && error.status === VerificationStatus.FAILURE);
  assert.deepEqual(apple.constructed.map(v => v.environment), [Environment.PRODUCTION]);
});

test("a sandbox purchase that names no Memo account grants nothing", async () => {
  const apple = loadApple({
    verdicts: { [Environment.PRODUCTION]: wrongEnvironment(), [Environment.SANDBOX]: { productId: "eu.memoai.premium.monthly" } },
  });
  await assert.rejects(apple.saveAppleTransaction("ey.sandbox"), error => error.name === "AppleNotificationRejected");
});

// Seen on production the same day: the recording account's new Monthly shared its original
// transaction with the deleted account's Yearly. Taking the Yearly would split one Apple
// subscription between two Memo accounts, so it stays refused while that account exists.
test("a subscription an existing account already holds part of is not taken over", async () => {
  const recording = "9f3d519c-ee62-4db5-b91f-b2cc1f43f071";
  const db = fakeDatabase({ users: [restorer, recording], rows: [{ user_id: recording, product_id: "eu.memoai.premium.trial.monthly",
    original_transaction_id: leftBehind.originalTransactionId, environment: "sandbox" }] });
  const apple = loadApple({ verdicts: { [Environment.PRODUCTION]: wrongEnvironment(), [Environment.SANDBOX]: leftBehind }, db });
  await assert.rejects(apple.saveAppleTransaction("ey.sandbox", restorer), (error) => error.name === "AppleAccountMismatch");
  assert.equal(db.rows.length, 1, "nothing written");
});
