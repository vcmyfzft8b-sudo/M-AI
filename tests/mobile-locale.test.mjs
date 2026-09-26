import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { NextRequest } from "next/server.js";
import * as locales from "../src/lib/i18n/locales.ts";

function load(file, modules) {
  const context = { exports: {}, Headers, require: name => {
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  } };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context.exports;
}

function request(country, chosen, native = true) {
  return {
    headers: new Headers({ "x-vercel-ip-country": country ?? "", "accept-language": "de-DE,de;q=0.9",
      "user-agent": native ? "Mozilla/5.0 MemoAI-iOS/1.0" : "Mozilla/5.0" }),
    nextUrl: new URL("https://memoai.eu/auth/continue"),
    cookies: { get: name => name === locales.LOCALE_COOKIE && chosen ? { value: chosen } : undefined,
      getAll: () => chosen ? [{ name: locales.LOCALE_COOKIE, value: chosen }] : [], set() {} },
  };
}

test("first native login uses exactly the same country language and persistent cookie as the PWA", async () => {
  for (const [country, expected] of [["SI", "sl"], ["HR", "hr"], ["BA", "bs"], ["RS", "sr"],
    ["DE", "en"], ["US", "en"], ["ME", "en"], ["", "en"], [" hr ", "hr"]]) {
    for (const native of [true, false]) {
      const req = request(country, undefined, native);
      const writes = [];
      const middleware = load("../src/lib/supabase/middleware.ts", {
        "@supabase/ssr": { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
        "next/server": { NextResponse: { next: () => ({ cookies: { set: (...args) => writes.push(args) } }) } },
        "@/lib/i18n/locales": locales,
        "@/lib/public-env": { getPublicEnv: () => ({ supabaseUrl: "https://staging.invalid", supabaseAnonKey: "synthetic" }) },
        "@/lib/mobile/account-lifecycle": { accountDeletionRequested: () => false },
        "@/lib/verified-page-user": { VERIFIED_PAGE_USER_HEADER: "x-memo-user" },
      });
      await middleware.updateSession(req);
      assert.equal(writes[0][0], "memo-locale");
      assert.equal(writes[0][1], expected);
      assert.equal(writes[0][2].maxAge, locales.LOCALE_COOKIE_MAX_AGE);

      // The very first server-rendered page must agree, before a cookie exists.
      const server = load("../src/lib/i18n/server.ts", {
        "server-only": {}, "next/headers": { cookies: async () => req.cookies, headers: async () => req.headers },
        react: { cache: fn => fn }, "@/lib/i18n/messages": {},
        "@/lib/i18n/locales": locales, "@/lib/i18n/translate": {},
      });
      assert.equal(await server.getLocale(), expected);
    }
  }
});

test("a chosen language wins over a new country and over the iPhone language", async () => {
  for (const chosen of locales.LOCALES) {
    const req = request("DE", chosen);
    const server = load("../src/lib/i18n/server.ts", {
      "server-only": {}, "next/headers": { cookies: async () => req.cookies, headers: async () => req.headers },
      react: { cache: fn => fn }, "@/lib/i18n/messages": {},
      "@/lib/i18n/locales": locales, "@/lib/i18n/translate": {},
    });
    assert.equal(await server.getLocale(), chosen);
  }
});

test("anonymous offline shells preserve a validated locale without adding account credentials", async () => {
  for (const [path, expected] of [
    ["/offline?locale=en", "en"], ["/offline?locale=hr", "hr"],
    ["/offline?locale=bs", "bs"], ["/offline?locale=sr", "sr"],
    ["/offline?locale=sl", "sl"], ["/offline?locale=invalid", "sl"],
    ["/onboarding?locale=hr", "sl"],
  ]) {
    const req = new NextRequest(`https://memoai.eu${path}`, {
      headers: { "x-vercel-ip-country": "SI" },
    });
    let forwarded;
    const middleware = load("../src/lib/supabase/middleware.ts", {
      "@supabase/ssr": { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
      "next/server": { NextResponse: { next: options => {
        forwarded = options.request.headers;
        return { cookies: { set() {} } };
      } } },
      "@/lib/i18n/locales": locales,
      "@/lib/public-env": { getPublicEnv: () => ({ supabaseUrl: "https://staging.invalid", supabaseAnonKey: "synthetic" }) },
      "@/lib/mobile/account-lifecycle": { accountDeletionRequested: () => false },
      "@/lib/verified-page-user": { VERIFIED_PAGE_USER_HEADER: "x-memo-user" },
    });
    await middleware.updateSession(req);
    const forwardedRequest = new NextRequest(req.url, { headers: forwarded });
    const server = load("../src/lib/i18n/server.ts", {
      "server-only": {}, "next/headers": { cookies: async () => forwardedRequest.cookies, headers: async () => forwarded },
      react: { cache: fn => fn }, "@/lib/i18n/messages": {},
      "@/lib/i18n/locales": locales, "@/lib/i18n/translate": {},
    });
    assert.equal(await server.getLocale(), expected, path);
    assert.equal(forwarded.has("x-memo-user"), false);
    assert.ok(forwardedRequest.cookies.getAll().every(cookie => cookie.name === "memo-locale"));
  }
});

test("all sign-in methods use account preference or seed the detected language", async () => {
  for (const [country, chosen, stored, expectedRequest, expectedSaved] of [
    ["RS", undefined, null, "sr", "sr"], ["SI", undefined, "hr", "sl", "hr"],
    ["BA", "en", null, "en", "en"], ["DE", "invalid", null, "en", "en"],
  ]) {
    const calls = [], writes = [];
    const sync = load("../src/lib/i18n/sign-in-locale.ts", {
      "server-only": {}, "./locales": locales,
      "./profile-locale": { reconcileLocaleOnSignIn: async (id, locale) => { calls.push([id, locale]); return stored ?? locale; } },
    });
    const response = { cookies: { set: (...args) => writes.push(args) } };
    assert.equal(await sync.applySignInLocale(request(country, chosen), response, "synthetic-user"), response);
    assert.equal(calls[0][1], expectedRequest);
    assert.equal(writes[0][1], expectedSaved);
  }
});
