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
  const callback = new URL(options.options.redirectTo);
  assert.equal(callback.protocol, "eu.memoai.memo.auth:"); assert.equal(callback.host, "google");
  assert.equal(callback.pathname, "/callback"); assert.equal(callback.searchParams.get("state"), body.state);
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
