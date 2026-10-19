import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PAYWALL_REASONS } from "../src/lib/paywall-reasons.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const loading = read("src/components/paywall-loading.tsx");
const css = read("src/app/redesign.css");

test("every feature's paywall has its own skeleton scene", () => {
  const scenes = loading.slice(loading.indexOf("function SceneSkeleton"));

  for (const reason of PAYWALL_REASONS) {
    assert.match(scenes, new RegExp(`case "${reason}":`), `no skeleton scene for "${reason}"`);
  }
});

test("the skeleton reserves the real scene's height", () => {
  assert.match(loading, /paywallHeroHeight\(reason,/);
});

test("the app's paywall skeleton shows no coupon and no struck price (Apple prices)", () => {
  assert.match(css, /html\[data-native\] :is\(\.memo-paywall-shell \.memo-nb-skel-ticket, \.memo-nb-skel-was\) \{ display: none; \}/);
});

test("a wheel or offer sheet replacing its skeleton does not open a second time", () => {
  assert.match(read("src/components/discount-offer.tsx"), /enteredSheet === "wheel" \? " entered"/);
  assert.match(css, /\.memo-sheet-full\.memo-nb-paper:is\(\.memo-wheel-sheet, \.memo-offer-sheet\)\.entered:not\(\.closing\),\n\.memo-scrim\.entered:not\(\.closing\) \{ animation: none; \}/);
});

test("the padlock's svg has room above the shackle, which WebKit would otherwise clip", () => {
  assert.match(read("src/components/paywall-hero.tsx"), /className="memo-nb-lock" viewBox="0 -30 118 170"/);
});
