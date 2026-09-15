import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import { accountDeletionRequested } from "../src/lib/mobile/account-lifecycle.ts";

function harness({ deleting = false, existingSubject, saveFails = false, exchangeFails = false } = {}) {
  const calls = [];
  class NextResponse extends Response {
    cookies = { set: (...args) => calls.push(["cookie", ...args]), getAll: () => [{ name: "sb-test-auth-token" }] };
    static json(data, init) { return new NextResponse(JSON.stringify(data), init); }
  }
  const user = { id: "synthetic-user", identities: [{ provider: "apple", identity_data: { sub: "subject" } }],
    app_metadata: deleting ? { memo_deletion_requested_at: "now" } : {}, user_metadata: {} };
  const modules = {
    "node:crypto": crypto, zod: { z }, "next/server": { NextResponse },
    "@/lib/request-validation": { parseJsonRequest: async (request, schema) => ({ success: true, data: schema.parse(await request.json()) }) },
    "@/lib/rate-limit": { rateLimitPresets: { authOAuth: [], authVerify: [] }, enforceRateLimit: async () => null },
    "@/lib/mobile/account-lifecycle": { accountDeletionRequested },
    "@/lib/i18n/sign-in-locale": { applySignInLocale: async (_request, response, userId) => { calls.push(["locale", userId]); return response; } },
    "@/lib/mobile/apple-identity": {
      appleSignInConfigured: () => true, nativeAppleClientID: () => "memo",
      verifyAppleIdentity: async () => { calls.push(["verify"]); return { sub: "subject" }; },
      exchangeAppleCode: async () => { calls.push(["exchange"]); if (exchangeFails) throw new Error("private exchange error"); return "secret-refresh"; },
      sealAppleToken: () => "encrypted-token", revokeAppleToken: async () => calls.push(["revoke"]),
    },
    "@/lib/supabase/server": {
      createSupabaseRouteHandlerClient: async () => ({ applyCookies: response => response, supabase: { auth: {
        getUser: async () => ({ data: { user: existingSubject ? { ...user, identities: [{ provider: "apple", identity_data: { sub: existingSubject } }] } : null } }),
        signInWithIdToken: async () => { calls.push(["signIn"]); return { data: { user, session: {} }, error: null }; },
        signOut: async () => calls.push(["signOut"]), updateUser: async () => calls.push(["name"]),
      } } }),
      createSupabaseServiceRoleClient: () => ({ from: () => ({ upsert: async row => {
        calls.push(["save", row]); return { error: saveFails ? new Error("private database error") : null };
      } }) }),
    },
  };
  const context = { exports: {}, require: name => modules[name], URL, Date };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/app/api/mobile/apple-auth/route.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { calls, async run({ origin = "https://memoai.eu", nonceMatches = true } = {}) {
    const nonce = "a".repeat(64);
    const request = new Request("https://memoai.eu/api/mobile/apple-auth", { method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ identityToken: "synthetic-identity", authorizationCode: "synthetic-code", nonce, fullName: "Synthetic Reviewer" }) });
    request.nextUrl = new URL(request.url);
    request.cookies = { get: () => ({ value: nonceMatches ? nonce : "other" }), getAll: () => [] };
    return context.exports.POST(request);
  } };
}

test("native Apple login rejects cross-site and mismatched nonce before authentication", async () => {
  for (const options of [{ origin: "https://attacker.invalid" }, { nonceMatches: false }]) {
    const h = harness(); assert.equal((await h.run(options)).status, 403);
    assert.equal(h.calls.length, 0);
  }
});
test("native Apple login saves only an encrypted owner-bound grant and consumes its challenge", async () => {
  const h = harness(); const response = await h.run();
  assert.equal(h.calls.find(c => c[0] === "locale")[1], "synthetic-user");
  assert.equal(response.status, 200);
  const row = h.calls.find(c => c[0] === "save")[1];
  assert.equal(row.user_id, "synthetic-user"); assert.equal(row.refresh_token_encrypted, "encrypted-token");
  assert.equal(JSON.stringify(row).includes("secret-refresh"), false);
  assert.ok(h.calls.some(c => c[0] === "cookie" && c[2] === "" && c[3].maxAge === 0));
  assert.equal((await response.text()).includes("token"), false);
});
test("failed or deleting Apple logins end the temporary session and revoke unused authorization", async () => {
  for (const options of [{ deleting: true }, { saveFails: true }]) {
    const h = harness(options); const response = await h.run();
    assert.equal(response.status, 401);
    assert.ok(h.calls.some(c => c[0] === "signOut")); assert.ok(h.calls.some(c => c[0] === "revoke"));
    assert.ok(h.calls.some(c => c[0] === "cookie" && c[1] === "sb-test-auth-token" && c[2] === ""));
    assert.equal((await response.text()).includes("private"), false);
  }
  const exchange = harness({ exchangeFails: true }); assert.equal((await exchange.run()).status, 401);
  assert.equal(exchange.calls.some(c => c[0] === "signIn"), false);
});
test("Apple reauthorization cannot switch an existing signed-in account", async () => {
  const h = harness({ existingSubject: "different-person" });
  assert.equal((await h.run()).status, 403);
  assert.equal(h.calls.some(c => c[0] === "exchange" || c[0] === "signIn"), false);
});
