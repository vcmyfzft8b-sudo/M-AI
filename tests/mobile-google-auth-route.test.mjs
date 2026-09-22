import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import { accountDeletionRequested } from "../src/lib/mobile/account-lifecycle.ts";

function harness({ enabled = true, deleting = false, existingId, exchangeFails = false, provider = "google", handoff = null, rpcFails = false } = {}) {
  const calls = [];
  class NextResponse extends Response {
    cookies = { set: (...args) => calls.push(["cookie", ...args]), getAll: () => [{ name: "sb-test-auth-token" }] };
    static json(data, init) { return new NextResponse(JSON.stringify(data), init); }
  }
  const user = { id: "synthetic-user", identities: [{ provider }], app_metadata: deleting ? { memo_deletion_requested_at: "now" } : {} };
  const modules = {
    "node:crypto": crypto, zod: { z }, "next/server": { NextResponse },
    "@/lib/auth-providers": { getAuthProviderAvailability: async () => ({ google: enabled }) },
    "@/lib/request-validation": { parseJsonRequest: async (request, schema) => {
      const parsed = schema.safeParse(await request.json());
      return parsed.success ? { success: true, data: parsed.data } : { success: false, response: NextResponse.json({}, { status: 400 }) };
    } },
    "@/lib/rate-limit": { rateLimitPresets: { authOAuth: [], authVerify: [] }, enforceRateLimit: async () => null },
    "@/lib/mobile/account-lifecycle": { accountDeletionRequested },
    "@/lib/i18n/sign-in-locale": { applySignInLocale: async (_request, response, id) => { calls.push(["locale", id]); return response; } },
    "@/lib/supabase/server": {
      createSupabaseServiceRoleClient: () => ({ rpc: async (name, args) => {
        calls.push(["rpc", name, args]);
        if (rpcFails) throw new Error("storage down");
        return { data: handoff ? [handoff] : [], error: null };
      } }),
      createSupabaseRouteHandlerClient: async () => ({
      applyCookies: response => { calls.push(["applyCookies"]); return response; },
      supabase: { auth: {
        getUser: async () => ({ data: { user: existingId ? { id: existingId } : null } }),
        signInWithOAuth: async options => { calls.push(["start", options]); return { data: { url: "https://staging.supabase.co/auth/v1/authorize" }, error: null }; },
        exchangeCodeForSession: async code => { calls.push(["exchange", code]); return { data: { user, session: exchangeFails ? null : { access_token: "private-token" } }, error: exchangeFails ? new Error("private error") : null }; },
        signOut: async () => calls.push(["signOut"]),
      } },
    }) },
  };
  const context = { exports: {}, require: name => modules[name], URL, process: { env: { NATIVE_GOOGLE_SIGN_IN_ENABLED: String(enabled) } } };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/app/api/mobile/google-auth/route.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { calls, async run({ method = "POST", origin = "https://memoai.eu", matches = true, state = "a".repeat(64), crossSite = false, poll = false, cookie = true } = {}) {
    const request = new Request(`https://memoai.eu/api/mobile/google-auth${poll ? "?poll=1" : ""}`, { method,
      headers: { origin, "content-type": "application/json", "sec-fetch-site": crossSite ? "cross-site" : "same-origin" },
      ...(method === "POST" ? { body: JSON.stringify({ code: "synthetic-code", state }) } : {}) });
    request.nextUrl = new URL(request.url);
    request.cookies = { get: () => (cookie ? { value: matches ? state : "wrong" } : undefined), getAll: () => [] };
    return context.exports[method](request);
  } };
}

test("native Google begins PKCE using a fixed callback and a short-lived HTTP-only challenge", async () => {
  const h = harness(); const response = await h.run({ method: "GET" });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json(); assert.match(body.state, /^[0-9a-f]{64}$/);
  const options = h.calls.find(c => c[0] === "start")[1];
  assert.equal(options.provider, "google"); assert.equal(options.options.skipBrowserRedirect, true);
  // The provider returns to our own HTTPS page, which bounces to the app's
  // scheme; asking the provider for that scheme directly is what failed
  // silently, so the callback must stay an ordinary address on this origin.
  const callback = new URL(options.options.redirectTo);
  assert.equal(callback.origin, "https://memoai.eu");
  assert.equal(callback.pathname, "/auth/mobile-callback");
  assert.equal(callback.searchParams.get("state"), body.state);
  const cookie = h.calls.find(c => c[0] === "cookie");
  assert.equal(cookie[3].httpOnly, true); assert.equal(cookie[3].sameSite, "strict"); assert.equal(cookie[3].maxAge, 600);
  assert.ok(h.calls.some(c => c[0] === "applyCookies"));
});
test("cross-site, disabled and invalid challenges never exchange a Google code", async () => {
  for (const options of [{ origin: "https://attacker.invalid" }, { matches: false }, { state: "bad" }]) {
    const h = harness(); assert.ok([400, 403].includes((await h.run(options)).status));
    assert.equal(h.calls.some(c => c[0] === "exchange"), false);
  }
  assert.equal((await harness().run({ method: "GET", crossSite: true })).status, 403);
  assert.equal((await harness({ enabled: false }).run()).status, 503);
});
test("Google completion consumes state and reconciles language without exposing session tokens", async () => {
  const h = harness(); const response = await h.run();
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { signedIn: true });
  assert.ok(h.calls.some(c => c[0] === "locale" && c[1] === "synthetic-user"));
  assert.ok(h.calls.some(c => c[0] === "cookie" && c[1] === "memo-google-state" && c[2] === "" && c[3].maxAge === 0));
});
test("Google completion rejects deleting users, wrong providers and account switching", async () => {
  for (const options of [{ deleting: true }, { existingId: "another-user" }, { provider: "email" }]) {
    const h = harness(options); const response = await h.run();
    assert.equal(response.status, 401); assert.ok(h.calls.some(c => c[0] === "signOut"));
    assert.ok(h.calls.some(c => c[0] === "cookie" && c[1] === "sb-test-auth-token" && c[2] === ""));
    assert.equal(h.calls.some(c => c[0] === "locale"), false);
  }
  const h = harness({ exchangeFails: true }); const response = await h.run();
  assert.equal(response.status, 401); assert.doesNotMatch(await response.text(), /private/);
});

// The page the provider returns to. It holds no session and spends no code: it
// exists so the sign-in sheet sees a navigation to the app's own scheme.
function loadBridge(rpcCalls) {
  const modules = {
    "next/server": { NextResponse: class extends Response {} },
    "@/lib/i18n/server": { tr: async key => key },
    "@/lib/supabase/server": { createSupabaseServiceRoleClient: () => ({
      rpc: async (name, args) => { rpcCalls.push([name, args]); return { data: null, error: null }; },
    }) },
  };
  const context = { exports: {}, require: name => { assert.ok(name in modules, name); return modules[name]; }, URL, URLSearchParams, JSON };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/app/auth/mobile-callback/route.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}

async function bounce(query) {
  const rpcCalls = [];
  const request = new Request(`https://memoai.eu/auth/mobile-callback?${new URLSearchParams(query)}`);
  request.nextUrl = new URL(request.url);
  const response = await loadBridge(rpcCalls).GET(request);
  const html = await response.text();
  // The page navigates from script; the same address is in the meta refresh
  // and in the visible link, so any of the three identifies it.
  const target = /location\.replace\("([^"]+)"\)/.exec(html)?.[1];
  return { status: response.status, headers: response.headers, html, rpcCalls,
    location: target ? new URL(target) : null };
}

test("the callback page offers the app both routes, and leaves nothing else behind", async () => {
  const state = "a".repeat(64);
  const ok = await bounce({ state, code: "synthetic-code" });
  assert.equal(ok.status, 200);
  assert.equal(ok.location.protocol, "eu.memoai.memo.auth:");
  assert.equal(ok.location.host, "google");
  assert.equal(ok.location.pathname, "/callback");
  assert.equal(ok.location.searchParams.get("state"), state);
  assert.equal(ok.location.searchParams.get("code"), "synthetic-code");
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.equal(ok.headers.get("referrer-policy"), "no-referrer");
  // ...and the same answer is written down for the web view inside the app.
  assert.deepEqual(ok.rpcCalls.map(c => c[0]), ["record_mobile_oauth_handoff"]);
  assert.equal(ok.rpcCalls[0][1].handoff_state, state);
  assert.equal(ok.rpcCalls[0][1].handoff_code, "synthetic-code");
  assert.equal(ok.rpcCalls[0][1].handoff_error, null);

  // A provider failure is carried across rather than ending the sheet silently.
  const failed = await bounce({ state, error: "access_denied", error_description: "user refused" });
  assert.equal(failed.location.searchParams.get("error"), "access_denied");
  assert.equal(failed.location.searchParams.get("error_description"), "user refused");
  assert.equal(failed.location.searchParams.get("code"), null);
  assert.equal(failed.rpcCalls[0][1].handoff_code, null);
  assert.match(failed.rpcCalls[0][1].handoff_error, /access_denied: user refused/);

  // No code at all is still a failure the app can name.
  assert.equal((await bounce({ state })).location.searchParams.get("error"), "missing_code");

  // A state that is not ours is dropped, and nothing is written down for it.
  const forged = await bounce({ state: "../evil", code: "x" });
  assert.equal(forged.location.searchParams.get("state"), null);
  assert.equal(forged.location.host, "google");
  assert.deepEqual(forged.rpcCalls, []);

  // Oversized values are never reflected.
  const huge = await bounce({ state, code: "c".repeat(4097) });
  assert.equal(huge.location.searchParams.get("code"), null);
  assert.equal(huge.location.searchParams.get("error"), "missing_code");

  // Provider text is not markup: it reaches the page escaped.
  const nasty = await bounce({ state, error: "x", error_description: '"><script>alert(1)</script>' });
  assert.doesNotMatch(nasty.html, /<script>alert/);
});

// The page inside the app's web view asking whether the sheet has finished.
test("polling signs in from the note the callback page left, and spends it", async () => {
  const h = harness({ handoff: { code: "handed-over-code", error: null } });
  const response = await h.run({ method: "GET", poll: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "signedIn" });
  assert.deepEqual(h.calls.find(c => c[0] === "rpc").slice(0, 2), ["rpc", "claim_mobile_oauth_handoff"]);
  assert.equal(h.calls.find(c => c[0] === "exchange")[1], "handed-over-code");
  assert.ok(h.calls.some(c => c[0] === "locale" && c[1] === "synthetic-user"));
  // The challenge is spent either way, so the same note cannot be replayed.
  assert.ok(h.calls.some(c => c[0] === "cookie" && c[1] === "memo-google-state" && c[2] === "" && c[3].maxAge === 0));
});

test("polling says nothing has happened until it has, and never invents a session", async () => {
  const waiting = harness();
  assert.deepEqual(await (await waiting.run({ method: "GET", poll: true })).json(), { status: "pending" });
  assert.equal(waiting.calls.some(c => c[0] === "exchange"), false);

  // No flow in this jar: nothing to answer, and no lookup worth making.
  const idle = harness();
  assert.deepEqual(await (await idle.run({ method: "GET", poll: true, cookie: false })).json(), { status: "idle" });
  assert.equal(idle.calls.some(c => c[0] === "rpc"), false);

  // A provider failure ends the flow rather than leaving it open forever.
  const failed = harness({ handoff: { code: null, error: "access_denied" } });
  assert.deepEqual(await (await failed.run({ method: "GET", poll: true })).json(), { status: "failed" });
  assert.equal(failed.calls.some(c => c[0] === "exchange"), false);
  assert.ok(failed.calls.some(c => c[0] === "cookie" && c[1] === "memo-google-state" && c[2] === ""));

  // The store being unavailable is not a failed sign-in: the sheet may still
  // hand the code over directly.
  const broken = harness({ rpcFails: true });
  assert.deepEqual(await (await broken.run({ method: "GET", poll: true })).json(), { status: "pending" });

  // A rejected account is refused on this route exactly as on the other.
  const deleting = harness({ deleting: true, handoff: { code: "handed-over-code", error: null } });
  assert.deepEqual(await (await deleting.run({ method: "GET", poll: true })).json(), { status: "failed" });
  assert.ok(deleting.calls.some(c => c[0] === "signOut"));

  // Polling is still gated by the flag and by cross-site checks.
  assert.equal((await harness({ enabled: false }).run({ method: "GET", poll: true })).status, 503);
  assert.equal((await harness().run({ method: "GET", poll: true, crossSite: true })).status, 403);
});
