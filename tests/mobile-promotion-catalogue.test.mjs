import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function catalogue(env) {
  let checkoutCalls = 0;
  class Stripe { constructor(key) { this.key = key; } }
  const modules = {
    "server-only": {}, stripe: { default: Stripe },
    "@/lib/billing": { getStripeClient: () => { checkoutCalls++; return { checkout: true }; } },
  };
  const context = { exports: {}, process: { env }, require: name => modules[name] };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/mobile/promotion-catalogue.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { get: () => context.exports.applePromotionCatalogue(), checkoutCalls: () => checkoutCalls };
}

test("Preview refuses missing or unrestricted live catalogue credentials without using checkout", () => {
  for (const key of [undefined, "", "sk_live_test_placeholder", "pk_live_test_placeholder"]) {
    const c = catalogue({ VERCEL_ENV: "preview", APPLE_PROMOTION_CATALOGUE_KEY: key });
    assert.throws(c.get);
    assert.equal(c.checkoutCalls(), 0);
  }
});

test("the dedicated restricted/sandbox catalogue credential never reaches the checkout client", () => {
  for (const key of ["rk_live_test_placeholder", "rk_test_test_placeholder", "sk_test_test_placeholder"]) {
    const c = catalogue({ VERCEL_ENV: "preview", APPLE_PROMOTION_CATALOGUE_KEY: ` ${key} ` });
    assert.equal(c.get().key, key);
    assert.equal(c.checkoutCalls(), 0);
  }
});

test("production can retain its existing configuration or select a dedicated read key", () => {
  const existing = catalogue({ VERCEL_ENV: "production" });
  assert.equal(existing.get().checkout, true);
  assert.equal(existing.checkoutCalls(), 1);
  const restricted = catalogue({ VERCEL_ENV: "production", APPLE_PROMOTION_CATALOGUE_KEY: "rk_live_test_placeholder" });
  assert.equal(restricted.get().key, "rk_live_test_placeholder");
  assert.equal(restricted.checkoutCalls(), 0);
});
