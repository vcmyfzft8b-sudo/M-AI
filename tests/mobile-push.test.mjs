import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

import { sl } from "../src/lib/i18n/messages/sl.ts";
import { en } from "../src/lib/i18n/messages/en.ts";
import { hr } from "../src/lib/i18n/messages/hr.ts";
import { bs } from "../src/lib/i18n/messages/bs.ts";
import { sr } from "../src/lib/i18n/messages/sr.ts";
import { isNativeUserAgent } from "../src/lib/mobile/runtime.ts";

const NATIVE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MemoAI-iOS/1.0";
const SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

const LECTURE = "11111111-2222-3333-4444-555555555555";

function transpile(path) {
  return ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}

/**
 * A Supabase stand-in.
 *
 * Every call chains, and awaiting the chain asks `resolve` what the database
 * would have said. The whole chain — table, verb, filters, payload — is handed
 * over, so a test can answer differently for the claim and for the send, and
 * can afterwards assert on what was written rather than only on what came back.
 */
function fakeSupabase(resolve) {
  const log = [];
  const chain = (table) => {
    const state = { table, verb: null, payload: null, filters: [], single: false };
    const self = {
      select() { state.verb ??= "select"; return self; },
      update(payload) { state.verb = "update"; state.payload = payload; return self; },
      upsert(payload) { state.verb = "upsert"; state.payload = payload; return self; },
      delete() { state.verb = "delete"; return self; },
      insert(payload) { state.verb = "insert"; state.payload = payload; return self; },
      eq(column, value) { state.filters.push(["eq", column, value]); return self; },
      is(column, value) { state.filters.push(["is", column, value]); return self; },
      lt(column, value) { state.filters.push(["lt", column, value]); return self; },
      gt(column, value) { state.filters.push(["gt", column, value]); return self; },
      order() { return self; },
      limit() { return self; },
      returns() { return self; },
      maybeSingle() { state.single = true; return self.then.bind(self); },
      then(onFulfilled, onRejected) {
        log.push(state);
        return Promise.resolve(resolve(state)).then(onFulfilled, onRejected);
      },
    };
    // `maybeSingle()` is awaited directly in the source, so it has to return a
    // thenable rather than the bound `then` alone.
    self.maybeSingle = () => { state.single = true; return self; };
    return self;
  };
  return { client: { from: (table) => chain(table) }, log };
}

/** Loads `push.ts` with the database and APNs replaced. */
function loadPush({ resolve, send }) {
  const sent = [];
  const { client, log } = fakeSupabase(resolve);
  const modules = {
    "@/lib/supabase/server": { createSupabaseServiceRoleClient: () => client },
    "@/lib/i18n/messages": { getMessages: (locale) => ({ sl, en, hr, bs, sr })[locale] ?? en },
    "@/lib/i18n/locales": { DEFAULT_LOCALE: "en", LOCALES: ["sl", "en", "hr", "bs", "sr"] },
    "@/lib/i18n/translate": {
      interpolate: (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => String(values?.[key] ?? "")),
    },
    "@/lib/mobile/apns": {
      applePushConfigured: () => true,
      sendApplePush: async (token, environment, alert) => {
        sent.push({ token, environment, alert });
        return send(token, environment);
      },
    },
  };
  const context = {
    exports: {}, Date, URL, Promise, JSON, console,
    require: (name) => { if (!(name in modules)) throw new Error(`Unstubbed import ${name}`); return modules[name]; },
  };
  vm.runInNewContext(transpile("lib/mobile/push.ts"), context);
  return { push: context.exports, sent, log };
}

/** Writes aimed at a single queue row, as opposed to the time-bounded expiry sweep. */
function rowWrites(log) {
  return log.filter((entry) => entry.table === "push_queue" && entry.verb === "update"
    && entry.filters.some(([op, name]) => op === "eq" && name === "id"));
}

const PENDING_ROW = { id: "row-1", user_id: "user-1", lecture_id: LECTURE, kind: "note_ready", attempts: 0 };

/** Answers the four queries a single successful delivery makes. */
function standardResolve(overrides = {}) {
  return (state) => {
    if (state.table === "push_queue" && state.verb === "select") return { data: overrides.pending ?? [PENDING_ROW] };
    if (state.table === "push_queue" && state.verb === "update" && !state.single) return { data: null };
    if (state.table === "push_queue" && state.verb === "update" && state.single) {
      return { data: overrides.claim === null ? null : { id: "row-1" } };
    }
    if (state.table === "push_queue") return { data: null };
    if (state.table === "push_devices" && state.verb === "select") {
      return { data: overrides.devices ?? [{ token: "aa", environment: "production", locale: "sl" }] };
    }
    if (state.table === "push_devices") return { data: null };
    if (state.table === "lectures") return { data: { title: "title" in overrides ? overrides.title : "Fotosinteza" } };
    return { data: null };
  };
}

test("a finished note is sent to the device, in the device's own language", async () => {
  const loaded = loadPush({ resolve: standardResolve(), send: () => ({ status: "sent", environment: "production" }) });
  const outcome = await loaded.push.deliverPendingPushNotifications();

  assert.deepEqual({ ...outcome }, { claimed: 1, sent: 1, skipped: 0, failed: 0 });
  assert.equal(loaded.sent.length, 1);
  assert.equal(loaded.sent[0].alert.title, sl["push.noteReady.title"]);
  assert.match(loaded.sent[0].alert.body, /Fotosinteza/);
  // The tap has to be able to find the note again.
  assert.deepEqual({ ...loaded.sent[0].alert.data }, { lectureId: LECTURE });

  const marked = rowWrites(loaded.log).find((entry) => entry.payload?.sent_at);
  assert.ok(marked, "the row is marked sent");
});

test("a note with no title says something other than 'null'", async () => {
  const loaded = loadPush({
    resolve: standardResolve({ title: null }),
    send: () => ({ status: "sent", environment: "production" }),
  });
  await loaded.push.deliverPendingPushNotifications();
  assert.match(loaded.sent[0].alert.body, new RegExp(sl["push.untitledNote"]));
  assert.doesNotMatch(loaded.sent[0].alert.body, /null|undefined/);
});

test("an unknown device locale falls back to English rather than failing", async () => {
  const loaded = loadPush({
    resolve: standardResolve({ devices: [{ token: "aa", environment: "production", locale: "pt-BR" }] }),
    send: () => ({ status: "sent", environment: "production" }),
  });
  await loaded.push.deliverPendingPushNotifications();
  assert.equal(loaded.sent[0].alert.title, en["push.noteReady.title"]);
});

test("a dead token is disabled, and the row is not left pending forever", async () => {
  const loaded = loadPush({
    resolve: standardResolve(),
    send: () => ({ status: "gone", reason: "Unregistered", environment: "production" }),
  });
  const outcome = await loaded.push.deliverPendingPushNotifications();

  const disabled = loaded.log.find((entry) => entry.table === "push_devices" && entry.payload?.disabled_at);
  assert.ok(disabled, "the device is disabled");
  assert.equal(disabled.payload.disabled_reason, "Unregistered");
  // Every device was dead, so there is nobody left to tell: retire, not retry.
  assert.equal(outcome.skipped, 1);
  assert.equal(outcome.failed, 0);
  const marked = rowWrites(loaded.log).find((entry) => entry.payload?.sent_at);
  assert.equal(marked.payload.last_error, "no live device");
});

test("a user with no device retires the row instead of retrying it hourly", async () => {
  const loaded = loadPush({
    resolve: standardResolve({ devices: [] }),
    send: () => ({ status: "sent", environment: "production" }),
  });
  const outcome = await loaded.push.deliverPendingPushNotifications();
  assert.deepEqual({ ...outcome }, { claimed: 1, sent: 0, skipped: 1, failed: 0 });
  assert.equal(loaded.sent.length, 0);
});

test("a transient failure leaves the row pending for the next sweep", async () => {
  const loaded = loadPush({
    resolve: standardResolve(),
    send: () => ({ status: "failed", reason: "HTTP 503", environment: "production" }),
  });
  const outcome = await loaded.push.deliverPendingPushNotifications();
  assert.equal(outcome.failed, 1);
  const writes = rowWrites(loaded.log);
  // The claim, then the error — and never a `sent_at`, which would retire it.
  assert.ok(writes.every((entry) => !entry.payload?.sent_at));
  assert.equal(writes.at(-1).payload.last_error, "HTTP 503");
});

test("a row another worker already claimed is left alone", async () => {
  const loaded = loadPush({
    resolve: standardResolve({ claim: null }),
    send: () => ({ status: "sent", environment: "production" }),
  });
  const outcome = await loaded.push.deliverPendingPushNotifications();
  assert.deepEqual({ ...outcome }, { claimed: 0, sent: 0, skipped: 0, failed: 0 });
  assert.equal(loaded.sent.length, 0, "a lost claim sends nothing");
});

test("the claim is a compare-and-swap on the attempt count", async () => {
  const loaded = loadPush({ resolve: standardResolve(), send: () => ({ status: "sent", environment: "production" }) });
  await loaded.push.deliverPendingPushNotifications();
  const claim = rowWrites(loaded.log).find((entry) => entry.single);
  assert.equal(claim.payload.attempts, 1);
  assert.deepEqual(claim.filters, [["eq", "id", "row-1"], ["eq", "attempts", 0]]);
});

test("a token that answered on the other APNs host has its environment corrected", async () => {
  const loaded = loadPush({
    resolve: standardResolve(),
    send: () => ({ status: "sent", environment: "sandbox" }),
  });
  await loaded.push.deliverPendingPushNotifications();
  const corrected = loaded.log.find((entry) => entry.table === "push_devices" && entry.payload?.environment);
  assert.equal(corrected.payload.environment, "sandbox");
});

test("nothing is sent, and nothing is read, when push is not configured", async () => {
  const { client, log } = fakeSupabase(() => ({ data: [] }));
  const modules = {
    "@/lib/supabase/server": { createSupabaseServiceRoleClient: () => client },
    "@/lib/i18n/messages": { getMessages: () => en },
    "@/lib/i18n/locales": { DEFAULT_LOCALE: "en", LOCALES: ["en"] },
    "@/lib/i18n/translate": { interpolate: (value) => value },
    "@/lib/mobile/apns": { applePushConfigured: () => false, sendApplePush: async () => { throw new Error("sent"); } },
  };
  const context = {
    exports: {}, Date, URL, Promise, JSON, console,
    require: (name) => modules[name],
  };
  vm.runInNewContext(transpile("lib/mobile/push.ts"), context);
  const outcome = await context.exports.deliverPendingPushNotifications();
  assert.deepEqual({ ...outcome }, { claimed: 0, sent: 0, skipped: 0, failed: 0 });
  assert.equal(log.length, 0, "an unconfigured deployment does not even query");
});

// ---------------------------------------------------------------------------
// The APNs reply mapping. Getting these backwards either loses a live device
// or retries a dead one forever.
// ---------------------------------------------------------------------------

function loadApns() {
  const context = {
    exports: {}, Date, URL, Promise, JSON, process,
    require: (name) => {
      if (name === "node:http2") return { connect: () => { throw new Error("not used"); }, constants: {} };
      if (name === "jose") return { importPKCS8: async () => ({}), SignJWT: class {} };
      throw new Error(`Unstubbed import ${name}`);
    },
  };
  vm.runInNewContext(transpile("lib/mobile/apns.ts"), context);
  return context.exports;
}

test("push is only configured when every piece of the key is present", () => {
  const apns = loadApns();
  const saved = { ...process.env };
  try {
    process.env.APPLE_PUSH_ENABLED = "true";
    process.env.APPLE_PUSH_KEY_ID = "";
    process.env.APPLE_PUSH_TEAM_ID = "TEAM";
    process.env.APPLE_PUSH_PRIVATE_KEY = "key";
    assert.equal(apns.applePushConfigured(), false, "no key id");
    process.env.APPLE_PUSH_KEY_ID = "KEYID";
    assert.equal(apns.applePushConfigured(), true);
    process.env.APPLE_PUSH_ENABLED = "false";
    assert.equal(apns.applePushConfigured(), false, "the flag still governs");
  } finally {
    process.env = saved;
  }
});

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

function loadRoute({ user = { id: "user-1" }, register = async () => {}, forget = async () => {} } = {}) {
  class NextResponse extends Response {
    static json(data, init) { return new NextResponse(JSON.stringify(data), init); }
  }
  const modules = {
    zod: { z }, "next/server": { NextResponse },
    "@/lib/mobile/runtime": { isNativeUserAgent },
    "@/lib/mobile/apns": { applePushConfigured: () => true },
    "@/lib/mobile/push": { registerPushDevice: register, forgetPushDevice: forget },
    "@/lib/supabase/server": {
      createSupabaseRouteHandlerClient: async () => ({
        supabase: { auth: { getUser: async () => ({ data: { user } }) } },
        applyCookies: (response) => response,
      }),
    },
    "@/lib/request-validation": {
      parseJsonRequest: async (request, schema) => {
        const parsed = schema.safeParse(await request.json());
        return parsed.success
          ? { success: true, data: parsed.data }
          : { success: false, response: NextResponse.json({ error: "bad" }, { status: 400 }) };
      },
    },
  };
  const context = {
    exports: {}, Request, Response, URL, Date, JSON, Promise,
    require: (name) => { if (!(name in modules)) throw new Error(`Unstubbed import ${name}`); return modules[name]; },
  };
  vm.runInNewContext(transpile("app/api/mobile/push-token/route.ts"), context);
  const call = (method, userAgent, body) => {
    const request = new Request("https://www.memoai.eu/api/mobile/push-token", {
      method, headers: { "user-agent": userAgent, "content-type": "application/json", origin: "https://www.memoai.eu" },
      body: JSON.stringify(body),
    });
    request.nextUrl = new URL("https://www.memoai.eu/api/mobile/push-token");
    return context.exports[method](request);
  };
  return call;
}

const TOKEN = "a".repeat(64);

test("the app can register a device token", async () => {
  const saved = [];
  const call = loadRoute({ register: async (input) => { saved.push(input); } });
  const response = await call("POST", NATIVE_UA, { token: TOKEN.toUpperCase(), environment: "production", locale: "sl" });
  assert.equal(response.status, 200);
  // Stored lower-case, so the same device cannot register twice under two spellings.
  assert.equal(saved[0].token, TOKEN);
  assert.equal(saved[0].userId, "user-1");
});

test("a browser cannot see the push endpoint at all", async () => {
  const saved = [];
  const call = loadRoute({ register: async (input) => { saved.push(input); } });
  assert.equal((await call("POST", SAFARI_UA, { token: TOKEN, environment: "production" })).status, 404);
  assert.deepEqual(saved, [], "and nothing is written");
});

test("a signed-out request cannot attach a token to anyone", async () => {
  const saved = [];
  const call = loadRoute({ user: null, register: async (input) => { saved.push(input); } });
  assert.equal((await call("POST", NATIVE_UA, { token: TOKEN, environment: "production" })).status, 401);
  assert.deepEqual(saved, []);
});

test("a token that is not a device token is refused", async () => {
  const call = loadRoute();
  for (const token of ["../../etc", "zz".repeat(32), "short", ""]) {
    assert.equal((await call("POST", NATIVE_UA, { token, environment: "production" })).status, 400, token);
  }
});

test("signing out retracts the token without needing the session", async () => {
  const removed = [];
  const call = loadRoute({ user: null, forget: async (token) => { removed.push(token); } });
  const response = await call("DELETE", NATIVE_UA, { token: TOKEN });
  assert.equal(response.status, 200);
  assert.deepEqual(removed, [TOKEN]);
});

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

test("every language can describe a finished and a failed note", () => {
  for (const [name, catalogue] of Object.entries({ sl, en, hr, bs, sr })) {
    for (const key of ["push.noteReady.title", "push.noteReady.body", "push.noteFailed.title", "push.noteFailed.body", "push.untitledNote"]) {
      assert.equal(typeof catalogue[key], "string", `${name} is missing ${key}`);
      assert.ok(catalogue[key].length > 0, `${name} leaves ${key} empty`);
    }
    // The note's name is the whole point of the notification.
    assert.match(catalogue["push.noteReady.body"], /\{title\}/, `${name} drops the note title`);
    assert.match(catalogue["push.noteFailed.body"], /\{title\}/, `${name} drops the note title`);
  }
});

test("a notification nobody could be told about in an hour expires instead of arriving late", async () => {
  const loaded = loadPush({ resolve: standardResolve(), send: () => ({ status: "sent", environment: "production" }) });
  await loaded.push.deliverPendingPushNotifications();

  // The sweep runs before anything is claimed, and it is bounded by time
  // rather than by row, so enabling push on a backlog cannot buzz a phone
  // once per note finished last month.
  const expiry = loaded.log.find((entry) => entry.table === "push_queue" && entry.payload?.last_error === "expired");
  assert.ok(expiry, "stale rows are retired");
  assert.ok(expiry.payload.sent_at, "and retired as settled, not left pending");
  const [verb, column] = expiry.filters.find(([, name]) => name === "created_at") ?? [];
  assert.equal(verb, "lt");
  assert.equal(column, "created_at");

  // And the read for live work only looks forward of the same horizon.
  const read = loaded.log.find((entry) => entry.table === "push_queue" && entry.verb === "select");
  assert.ok(read.filters.some(([op, name]) => op === "gt" && name === "created_at"), "the send skips stale rows too");
});

test("the flush is awaited, because a floating promise on serverless never runs", () => {
  // Measured in production: two notes settled, the trigger queued both, and
  // neither was ever claimed — the instance had already been frozen. Every
  // notification then waits for the hourly sweep, which is both far too slow
  // for "your notes are ready" and close enough to the one-hour expiry to
  // start dropping them outright.
  const source = readFileSync(new URL("../src/lib/mobile/push.ts", import.meta.url), "utf8");
  assert.match(source, /export async function flushPushNotifications/);
  assert.doesNotMatch(source, /void deliverPendingPushNotifications/, "the flush is fired and forgotten again");

  for (const path of ["../src/lib/manual-lectures.ts", "../src/lib/scan-processing.ts"]) {
    const caller = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(caller, /await flushPushNotifications\(\)/, `${path} does not await the flush`);
  }
});

test("a finished note is still finished when the push cannot be sent", async () => {
  // The whole reason it was fired and forgotten was that a note must not fail
  // because a phone is unreachable. Awaiting it must not give that up.
  const loaded = loadPush({
    resolve: () => { throw new Error("database unreachable"); },
    send: () => ({ status: "sent", environment: "production" }),
  });
  await loaded.push.flushPushNotifications();
});

test("the permission sheet closes on the press, whichever way it is answered", () => {
  const prompt = readFileSync(new URL("../src/components/push-prompt.tsx", import.meta.url), "utf8");

  // `useSheet` reads its lock through a ref updated only in an effect, so
  // unlocking and dismissing in one tick dismisses against the previous
  // render's lock and the sheet refuses to close — leaving it behind the iOS
  // alert, and unrecoverable, because iOS never prompts a second time.
  assert.doesNotMatch(prompt, /useSheet\(close, \{ locked/, "the sheet is locked while the request runs");
  assert.match(prompt, /useSheet\(close\)/);

  // Dismissed before the native call, not after it.
  const allow = prompt.slice(prompt.indexOf("function allow()"), prompt.indexOf("if (!open)"));
  assert.ok(
    allow.indexOf("sheet.dismiss()") < allow.indexOf("enablePushNotifications"),
    "the sheet still waits for the round trip before closing",
  );
  assert.doesNotMatch(allow, /await nativeRequest/, "the press is blocked on the reply again");
});

test("delivery does not depend on a call site being reached", () => {
  // The enqueue lives in a trigger precisely so no path can forget it. Sending
  // needed the same guarantee: in production the trigger queued every
  // notification and the inline flush never ran for them, so nothing went out
  // until the sweep. The sweep is therefore the mechanism, not the net.
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const cron = vercel.crons.find((entry) => entry.path.startsWith("/api/cron/push-queue"));
  assert.ok(cron, "nothing drains the queue on a schedule");
  assert.equal(cron.schedule, "* * * * *", "the drain is too rare to be the delivery path");
});

test("two drains racing cannot send the same notification twice", () => {
  // Every minute means a slow run can still be going when the next starts.
  const source = readFileSync(new URL("../src/lib/mobile/push.ts", import.meta.url), "utf8");
  assert.match(source, /\.eq\("attempts", row\.attempts\)/, "the claim is not a compare-and-swap");
});
