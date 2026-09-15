import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import { emailAddressSchema, nextPathSchema } from "../src/lib/validation.ts";
import { accountDeletionRequested } from "../src/lib/mobile/account-lifecycle.ts";

function harness({ badPassword = false, deleting = false, rateLimited = false } = {}) {
  const calls = [];
  class NextResponse extends Response {
    static redirect(url, init) { return new Response(null, { ...init, headers: { Location: String(url) } }); }
  }
  const modules = {
    "node:crypto": crypto, zod: { z }, "next/server": { NextResponse },
    "@/lib/validation": { emailAddressSchema, nextPathSchema },
    "@/lib/mobile/account-lifecycle": { accountDeletionRequested },
    "@/lib/i18n/sign-in-locale": { applySignInLocale: async (_request, response, userId) => { calls.push(["locale", userId]); return response; } },
    "@/lib/request-validation": { parseFormDataRequest: async r => ({ success: true, data: await r.formData() }) },
    "@/lib/rate-limit": { rateLimitPresets: { authVerify: [] }, enforceRateLimit: async args => { calls.push(["limit", args.route]); return rateLimited ? new Response(null, { status: 429 }) : null; } },
    "@/lib/supabase/server": { createSupabaseRouteHandlerClient: async () => ({
      applyCookies: response => { response.headers.set("x-test-cookies-applied", "true"); return response; },
      supabase: { auth: {
        signInWithPassword: async input => {
          calls.push(["password", input]);
          return badPassword ? { data: { user: null, session: null }, error: new Error("private provider diagnostic") }
            : { data: { user: { id: "synthetic-user", app_metadata: deleting ? { memo_deletion_requested_at: "now" } : {} }, session: {} }, error: null };
        },
        signOut: async () => { calls.push(["signOut"]); },
      } },
    }) },
  };
  const context = { exports: {}, require: name => modules[name], URL };
  const source = readFileSync(new URL("../src/app/auth/password/verify/route.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { calls, async run({ origin = "https://memoai.eu", password = "  exact synthetic password  ", next = "/app/start?from=login" } = {}) {
    const body = new URLSearchParams({ email: "SYNTHETIC@example.test", password, next });
    const request = new Request("https://memoai.eu/auth/password/verify", { method: "POST", headers: { origin }, body });
    request.nextUrl = new URL(request.url);
    return context.exports.POST(request);
  } };
}

test("password login preserves opaque passwords and redirects only within the app", async () => {
  const h = harness(); const response = await h.run();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://memoai.eu/app/start?from=login");
  assert.equal(response.headers.get("x-test-cookies-applied"), "true");
  assert.equal(h.calls.find(c => c[0] === "locale")[1], "synthetic-user");
  assert.equal(h.calls.find(c => c[0] === "password")[1].password, "  exact synthetic password  ");
  assert.equal(h.calls.find(c => c[0] === "password")[1].email, "synthetic@example.test");
  const redirected = await harness().run({ next: "//evil.invalid" });
  assert.equal(new URL(redirected.headers.get("location")).origin, "https://memoai.eu");
});

test("cross-site and rate-limited requests never authenticate", async () => {
  const cross = harness(); assert.equal((await cross.run({ origin: "https://evil.invalid" })).status, 403);
  assert.equal(cross.calls.length, 0);
  const limited = harness({ rateLimited: true }); assert.equal((await limited.run()).status, 429);
  assert.equal(limited.calls.some(c => c[0] === "password"), false);
});

test("invalid credentials stay generic and deleting accounts lose the new session", async () => {
  const bad = await harness({ badPassword: true }).run();
  assert.equal(new URL(bad.headers.get("location")).searchParams.get("error"), "invalid");
  assert.equal(bad.headers.get("location").includes("private"), false);
  const h = harness({ deleting: true }); const response = await h.run();
  assert.equal(new URL(response.headers.get("location")).pathname, "/auth/password");
  assert.equal(h.calls.some(c => c[0] === "signOut"), true);
});
