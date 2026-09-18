import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import { accountDeletionRequested } from "../src/lib/mobile/account-lifecycle.ts";

function harness({ enabled = true, deleting = false, existingId, exchangeFails = false, provider = "google" } = {}) {
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
    "@/lib/supabase/server": { createSupabaseRouteHandlerClient: async () => ({
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
  return { calls, async run({ method = "POST", origin = "https://memoai.eu", matches = true, state = "a".repeat(64), crossSite = false } = {}) {
    const request = new Request("https://memoai.eu/api/mobile/google-auth", { method,
      headers: { origin, "content-type": "application/json", "sec-fetch-site": crossSite ? "cross-site" : "same-origin" },
      ...(method === "POST" ? { body: JSON.stringify({ code: "synthetic-code", state }) } : {}) });
    request.nextUrl = new URL(request.url);
    request.cookies = { get: () => ({ value: matches ? state : "wrong" }), getAll: () => [] };
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
function loadBridge() {
  const modules = { "next/server": { NextResponse: class extends Response {} } };
  const context = { exports: {}, require: name => modules[name], URL, URLSearchParams };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/app/auth/mobile-callback/route.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}

const bridge = loadBridge();

async function bounce(query) {
  const request = new Request(`https://memoai.eu/auth/mobile-callback?${new URLSearchParams(query)}`);
  request.nextUrl = new URL(request.url);
  const response = await bridge.GET(request);
  return { status: response.status, location: new URL(response.headers.get("location")), headers: response.headers };
}

test("the callback page bounces the provider's answer to the app, and nothing else", async () => {
  const state = "a".repeat(64);
  const ok = await bounce({ state, code: "synthetic-code" });
  assert.equal(ok.status, 302);
  assert.equal(ok.location.protocol, "eu.memoai.memo.auth:");
  assert.equal(ok.location.host, "google");
  assert.equal(ok.location.pathname, "/callback");
  assert.equal(ok.location.searchParams.get("state"), state);
  assert.equal(ok.location.searchParams.get("code"), "synthetic-code");
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.equal(ok.headers.get("referrer-policy"), "no-referrer");

  // A provider failure is carried across rather than ending the sheet silently.
  const failed = await bounce({ state, error: "access_denied", error_description: "user refused" });
  assert.equal(failed.location.searchParams.get("error"), "access_denied");
  assert.equal(failed.location.searchParams.get("error_description"), "user refused");
  assert.equal(failed.location.searchParams.get("code"), null);

  // No code at all is still a failure the app can name.
  assert.equal((await bounce({ state })).location.searchParams.get("error"), "missing_code");

  // A state that is not ours is dropped, so the app refuses what comes back.
  const forged = await bounce({ state: "../evil", code: "x" });
  assert.equal(forged.location.searchParams.get("state"), null);
  assert.equal(forged.location.host, "google");

  // Oversized values are never reflected.
  const huge = await bounce({ state, code: "c".repeat(4097) });
  assert.equal(huge.location.searchParams.get("code"), null);
  assert.equal(huge.location.searchParams.get("error"), "missing_code");
});
