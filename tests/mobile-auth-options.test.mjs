import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { isNativeUserAgent } from "../src/lib/mobile/runtime.ts";

function load(path, modules, globals = {}) {
  const context = { exports: {}, require: name => {
    assert.ok(name in modules, `Unexpected module ${name}`);
    return modules[name];
  }, ...globals };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return context.exports;
}

async function availability({ native = true, configured = true, appleEnabled = true, settingsFail = false, webConfigured = false, googleConfigured = true } = {}) {
  const { getAuthProviderAvailability } = load("../src/lib/auth-providers.ts", {
    "server-only": {},
    "next/headers": { headers: async () => new Headers({ "user-agent": native ? "Mozilla/5.0 MemoAI-iOS/1.0" : "Mozilla/5.0" }) },
    "@/lib/mobile/runtime": { isNativeUserAgent },
    "@/lib/mobile/apple-identity": { appleSignInConfigured: () => configured },
    "@/lib/public-env": { getPublicEnv: () => ({ supabaseUrl: "https://synthetic.invalid" }) },
  }, {
    process: { env: { NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic", APPLE_WEB_SIGN_IN_ENABLED: String(webConfigured), NATIVE_GOOGLE_SIGN_IN_ENABLED: String(googleConfigured) } },
    fetch: async () => ({ ok: !settingsFail, json: async () => ({ external: { apple: appleEnabled, google: true, email: true } }) }),
  });
  return getAuthProviderAvailability();
}

const { LandingAuthOptions } = load("../src/components/landing-auth-options.tsx", {
  react: React, "react/jsx-runtime": jsx,
  "next/navigation": { useRouter: () => ({ push() {} }) },
  "@/components/i18n-provider": { useT: () => key => ({
    "auth.continueApple": "Continue with Apple", "auth.continueEmail": "Continue with email",
    "auth.continueGoogle": "Continue with Google", "auth.or": "OR",
  })[key] ?? key },
  "@/components/msym": { Msym: () => null },
  "@/lib/mobile/client": { isNativeIOS: () => true, nativeRequest() { throw new Error("No native calls during rendering"); } },
});

test("configured iOS login renders Google, Apple and email together", async () => {
  const providers = await availability();
  const html = renderToStaticMarkup(React.createElement(LandingAuthOptions, { providers, next: "/app/start" }));
  assert.match(html, /Continue with Apple/);
  assert.match(html, /Continue with email/);
  assert.match(html, /Continue with Google/);
  assert.match(html, /action="\/auth\/apple"/);
});

test("native Google stays gated until the secure browser callback is configured", async () => {
  assert.equal((await availability({ googleConfigured: false })).google, false);
  assert.equal((await availability({ native: false, googleConfigured: false })).google, true);
});

test("iOS does not expose an unusable Apple login before both backend and provider are configured", async () => {
  for (const settings of [{ configured: false }, { appleEnabled: false }, { settingsFail: true }]) {
    const providers = await availability(settings);
    const html = renderToStaticMarkup(React.createElement(LandingAuthOptions, { providers, next: "/app/start" }));
    assert.doesNotMatch(html, /Continue with Apple/);
  }
});

test("web Apple and Google availability does not depend on native Apple credentials", async () => {
  const providers = await availability({ native: false, configured: false, webConfigured: true });
  assert.equal(providers.apple, true);
  assert.equal(providers.google, true);
  assert.equal(providers.email, true);
});

test("enabling native Apple authentication alone does not expose unconfigured browser OAuth", async () => {
  const providers = await availability({ native: false });
  assert.equal(providers.apple, false);
  assert.equal(providers.google, true);
  assert.equal(providers.email, true);
});
