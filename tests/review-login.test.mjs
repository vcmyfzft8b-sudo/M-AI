import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import { emailAddressSchema, nextPathSchema, normalizeNextPath, sanitizeUserInput, verificationCodeSchema } from "../src/lib/validation.ts";
import { accountDeletionRequested } from "../src/lib/mobile/account-lifecycle.ts";

const REVIEW_EMAIL = "review@example.test";
const REVIEW_CODE = "246810";

function load(path, modules, env) {
  const context = { exports: {}, require: name => { assert.ok(name in modules, `Unexpected module ${name}`); return modules[name]; },
    URL, Buffer, process: { env } };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context.exports;
}

function reviewLogin(env) {
  return load("../src/lib/review-login.ts", { "server-only": {}, "node:crypto": { timingSafeEqual: (a, b) => a.equals(b) } }, env);
}

test("the fixed code belongs to the configured accounts only, and only when configured", () => {
  const configured = reviewLogin({ APP_REVIEW_ACCOUNT_EMAILS: ` ${REVIEW_EMAIL.toUpperCase()} , qa@example.test`, APP_REVIEW_LOGIN_CODE: REVIEW_CODE });
  assert.equal(configured.isReviewAccount(REVIEW_EMAIL), true);
  assert.equal(configured.isReviewAccount("learner@example.test"), false);
  assert.equal(configured.reviewCodeMatches(REVIEW_EMAIL, ` ${REVIEW_CODE} `), true);
  assert.equal(configured.reviewCodeMatches(REVIEW_EMAIL, "000000"), false);
  assert.equal(configured.reviewCodeMatches("learner@example.test", REVIEW_CODE), false);
  for (const env of [{}, { APP_REVIEW_ACCOUNT_EMAILS: REVIEW_EMAIL }, { APP_REVIEW_LOGIN_CODE: REVIEW_CODE }]) {
    const off = reviewLogin(env);
    assert.equal(off.reviewCodeMatches(REVIEW_EMAIL, REVIEW_CODE), false);
    assert.equal(off.isReviewAccount(REVIEW_EMAIL), env.APP_REVIEW_ACCOUNT_EMAILS === REVIEW_EMAIL);
  }
});

function verifyHarness({ deleting = false } = {}) {
  const calls = [];
  class NextResponse extends Response {
    static redirect(url, init) { return new Response(null, { ...init, headers: { Location: String(url) } }); }
  }
  const env = { APP_REVIEW_ACCOUNT_EMAILS: REVIEW_EMAIL, APP_REVIEW_LOGIN_CODE: REVIEW_CODE };
  const modules = {
    zod: { z }, "next/server": { NextResponse },
    "@/lib/validation": { emailAddressSchema, nextPathSchema, normalizeNextPath, sanitizeUserInput, verificationCodeSchema },
    "@/lib/mobile/account-lifecycle": { accountDeletionRequested },
    "@/lib/review-login": reviewLogin(env),
    "@/lib/i18n/server": { tr: async key => key },
    "@/lib/request-validation": { parseFormDataRequest: async r => ({ success: true, data: await r.formData() }) },
    "@/lib/rate-limit": { rateLimitPresets: { authVerify: [] }, enforceRateLimit: async () => null },
    "@/lib/supabase/server": {
      createSupabaseRouteHandlerClient: async () => ({
        applyCookies: response => { response.headers.set("x-test-cookies-applied", "true"); return response; },
        supabase: { auth: { verifyOtp: async input => { calls.push(["verifyOtp", input]); return { error: null }; } } },
      }),
      createSupabaseServiceRoleClient: () => ({ auth: { admin: { generateLink: async input => {
        calls.push(["generateLink", input]);
        return { data: { user: { id: "review-user", app_metadata: deleting ? { memo_deletion_requested_at: "now" } : {} },
          properties: { hashed_token: "hashed-synthetic" } }, error: null };
      } } } }),
    },
  };
  const route = load("../src/app/auth/email/verify/route.ts", modules, env);
  return { calls, async run({ email = REVIEW_EMAIL, code = REVIEW_CODE } = {}) {
    const body = new URLSearchParams({ email, code, mode: "login", next: "/app" });
    const request = new Request("https://memoai.eu/auth/email/verify", { method: "POST", body });
    request.nextUrl = Object.assign(new URL(request.url), { clone() { return new URL(request.url); } });
    return route.POST(request);
  } };
}

test("a review account's fixed code opens a session from an admin link that never leaves the server", async () => {
  const h = verifyHarness();
  const response = await h.run();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://memoai.eu/app");
  assert.equal(response.headers.get("x-test-cookies-applied"), "true");
  // Compared as JSON: the route builds its objects inside the vm context, so
  // their prototypes differ from this file's and deepEqual rejects them.
  assert.equal(JSON.stringify(h.calls), JSON.stringify([
    ["generateLink", { type: "magiclink", email: REVIEW_EMAIL }],
    ["verifyOtp", { token_hash: "hashed-synthetic", type: "magiclink" }],
  ]));
});

test("every other code, and every other account, goes to Supabase as a mailed code", async () => {
  const wrongCode = verifyHarness();
  await wrongCode.run({ code: "135791" });
  assert.equal(JSON.stringify(wrongCode.calls), JSON.stringify([["verifyOtp", { email: REVIEW_EMAIL, token: "135791", type: "email" }]]));
  const learner = verifyHarness();
  await learner.run({ email: "learner@example.test" });
  assert.equal(JSON.stringify(learner.calls), JSON.stringify([["verifyOtp", { email: "learner@example.test", token: REVIEW_CODE, type: "email" }]]));
});

test("a review account that is being deleted cannot get back in with the fixed code", async () => {
  const h = verifyHarness({ deleting: true });
  const response = await h.run();
  assert.equal(new URL(response.headers.get("location")).pathname, "/auth/check-email");
  assert.equal(h.calls.some(c => c[0] === "verifyOtp"), false);
});
