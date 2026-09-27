import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server.js";
import * as locales from "../src/lib/i18n/locales.ts";
import * as authUser from "../src/lib/supabase/auth-user.ts";

// 2026-09-27 (Sentry 149777630): the proxy refreshed sessions for pages only, and API handlers
// never write what they refresh. A tutor walkthrough, which only talks to the API, kept sending
// its expired token, every request refreshed it again, Auth answered 429, and the refused
// refreshes read the learner's own note as "Ni najdeno.". These drive the real proxy with the
// real @supabase/ssr client against a fake Auth.
const SUPABASE_URL = "https://project.supabase.co";
const COOKIE = "sb-project-auth-token";
const USER = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "qa@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const now = () => Math.floor(Date.now() / 1000);
const session = (expiresAt, token = "old") => ({ access_token: `${token}-access`, token_type: "bearer", expires_in: 3600, expires_at: expiresAt, refresh_token: `${token}-refresh`, user: USER });
const encode = (value) => "base64-" + Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = (value) => JSON.parse(Buffer.from(value.replace(/^base64-/, ""), "base64url").toString());

/** Auth that renews, rate-limits, or rejects every refresh, and counts them. */
function auth(answer) {
  const seen = { refreshes: 0 };
  const fetch = async (input) => {
    const url = String(input?.url ?? input);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/auth/v1/token")) {
      seen.refreshes += 1;
      if (answer === "renew") return json(session(now() + 3600, "fresh"));
      if (answer === "rate-limit") return json({ code: 429, error_code: "over_request_rate_limit", msg: "Request rate limit reached" }, 429);
      return json({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }, 400);
    }
    if (url.includes("/auth/v1/user")) return json(USER);
    throw new Error("unexpected request " + url);
  };
  return { seen, fetch };
}

function proxy(fetch) {
  const forwarded = [];
  const context = { exports: {}, Headers, require: (name) => {
    const modules = {
      "@supabase/ssr": { createServerClient: (url, key, options) => createServerClient(url, key, { ...options, global: { fetch } }) },
      "next/server": { NextResponse: { next: (options) => {
        forwarded.push(options.request.headers);
        return NextResponse.next(options);
      } } },
      "@/lib/i18n/locales": locales,
      "@/lib/public-env": { getPublicEnv: () => ({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: "anon" }) },
      "@/lib/supabase/auth-user": authUser,
      "@/lib/mobile/account-lifecycle": { accountDeletionRequested: () => false },
      "@/lib/verified-page-user": { VERIFIED_PAGE_USER_HEADER: "x-memo-user", serializeVerifiedPageUser: (user) => user.id },
    };
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  } };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/supabase/middleware.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return { updateSession: context.exports.updateSession, forwarded };
}

async function run(path, stored, answer) {
  const { seen, fetch } = auth(answer);
  const { updateSession, forwarded } = proxy(fetch);
  const headers = { "x-vercel-ip-country": "SI" };
  if (stored) headers.cookie = `${COOKIE}=${encode(stored)}; memo-locale=sl`;
  const response = await updateSession(new NextRequest(`https://www.memoai.eu${path}`, { headers }));
  const handler = new NextRequest(`https://www.memoai.eu${path}`, { headers: forwarded.at(-1) });
  const sent = Object.fromEntries(response.cookies.getAll().filter(({ name }) => name.startsWith("sb-")).map(({ name, value }) => [name, value]));
  return { refreshes: seen.refreshes, sent, handlerSession: handler.cookies.get(COOKIE)?.value };
}

const TUTOR = "/api/lectures/4f5d71f3-ea9b-47ea-9a22-e9bb3db45492/tutor/turn";

test("an API request with an expired token is refreshed once, for the handler and the browser", async () => {
  const result = await run(TUTOR, session(now() - 60), "renew");
  assert.equal(result.refreshes, 1);
  assert.equal(decode(result.handlerSession).access_token, "fresh-access", "the handler must not refresh again");
  assert.equal(decode(result.sent[COOKIE]).refresh_token, "fresh-refresh", "the browser must stop sending the expired token");
});

test("an API request with a live token costs no call to Auth and writes nothing", async () => {
  const result = await run(TUTOR, session(now() + 1800), "renew");
  assert.equal(result.refreshes, 0);
  assert.deepEqual(result.sent, {});
  assert.equal(decode(result.handlerSession).access_token, "old-access");
});

test("a refused refresh on an API request never signs the learner out", async () => {
  for (const answer of ["rate-limit", "invalid"]) {
    const result = await run(TUTOR, session(now() - 60), answer);
    assert.equal(result.refreshes, 1, answer);
    assert.deepEqual(result.sent, {}, `${answer}: no cookie is written or deleted`);
    assert.equal(decode(result.handlerSession).refresh_token, "old-refresh", `${answer}: the handler still sees the session and answers as before`);
  }
});

test("routes that set a session themselves, and requests without one, are left alone", async () => {
  for (const path of ["/api/mobile/google-auth", "/api/mobile/apple-auth", "/api/admin/impersonate", "/api/account/delete"]) {
    const result = await run(path, session(now() - 60), "renew");
    assert.equal(result.refreshes, 0, path);
    assert.deepEqual(result.sent, {}, path);
  }
  const anonymous = await run(TUTOR, null, "renew");
  assert.equal(anonymous.refreshes, 0);
});

test("a page keeps its session through a rate-limited refresh but still drops a dead one", async () => {
  const limited = await run("/app", session(now() - 60), "rate-limit");
  assert.deepEqual(limited.sent, {}, "a 429 must not sign the learner out");

  const dead = await run("/app", session(now() - 60), "invalid");
  assert.equal(dead.sent[COOKIE], "", "a refresh token Auth no longer knows still ends the session");

  const renewed = await run("/app", session(now() - 60), "renew");
  assert.equal(decode(renewed.sent[COOKIE]).refresh_token, "fresh-refresh");
});

test("every API route that writes its own session cookies is on the proxy's skip list", () => {
  const middleware = readFileSync(new URL("../src/lib/supabase/middleware.ts", import.meta.url), "utf8");
  const skipped = JSON.parse(middleware.match(/SESSION_WRITING_API_ROUTES = (\[[^\]]*\])/)[1]);
  const walk = (dir) => readdirSyncDeep(dir).filter((file) => file.pathname.endsWith("/route.ts"));
  for (const file of walk(new URL("../src/app/api/", import.meta.url))) {
    if (!readFileSync(file, "utf8").includes("createSupabaseRouteHandlerClient")) continue;
    const route = "/api/" + file.pathname.split("/src/app/api/")[1].replace(/\/route\.ts$/, "");
    assert.ok(skipped.some((prefix) => decodeURIComponent(route).startsWith(prefix)), `${route} sets session cookies`);
  }
});

function readdirSyncDeep(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    return entry.isDirectory() ? readdirSyncDeep(url) : [url];
  });
}
