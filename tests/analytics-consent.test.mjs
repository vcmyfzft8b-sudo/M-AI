import assert from "node:assert/strict";
import test from "node:test";
import { ANALYTICS_COOKIE, ANALYTICS_MAX_AGE, hasAnalyticsConsent, readAnalyticsConsent, setAnalyticsConsent } from "../src/lib/analytics-consent.ts";

test("only a current explicit opt-in permits analytics", () => {
  const now = 1790090000000;
  for (const value of [undefined, "true", "granted", `v0.granted.${now}`, `v1.denied.${now}`, `v1.granted.${now + 1}`, `v1.granted.${now - ANALYTICS_MAX_AGE * 1000}`]) {
    assert.equal(hasAnalyticsConsent(value, now), false, String(value));
  }
  assert.equal(hasAnalyticsConsent(`v1.granted.${now}`, now), true);
  assert.equal(hasAnalyticsConsent(`v1.granted.${now - ANALYTICS_MAX_AGE * 1000 + 1}`, now), true);
});

function withBrowser(blocked, run) {
  // These cases are the iOS app's opt-in; the website's default is tested below.
  const names = ["document", "window", "location", "localStorage", "navigator"];
  const original = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const cookies = new Map([["memo-visit", "existing-session"]]);
  const writes = [];
  const document = {
    get cookie() { if (blocked) throw Error("SecurityError"); return [...cookies].map(([k,v]) => `${k}=${v}`).join("; "); },
    set cookie(value) {
      if (blocked) throw Error("SecurityError");
      writes.push(value);
      const [pair] = value.split(";"); const [key, val] = pair.split("=");
      if (value.includes("Max-Age=0")) cookies.delete(key); else cookies.set(key, val);
    },
  };
  const browser = { document, window: new EventTarget(), location: { protocol: "https:" }, localStorage: { setItem() { throw Error("Blocked localStorage"); } }, navigator: { userAgent: "Mozilla/5.0 (iPhone) MemoAI-iOS/1.0" } };
  names.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: browser[name] }));
  try { run(cookies, writes); } finally { names.forEach((name, i) => original[i] ? Object.defineProperty(globalThis, name, original[i]) : delete globalThis[name]); }
}

test("opt-in persists only after the cookie is written; withdrawal removes visitor identity", () => withBrowser(false, (cookies, writes) => {
  assert.equal(readAnalyticsConsent(), false);
  assert.equal(setAnalyticsConsent(true), true);
  assert.equal(readAnalyticsConsent(), true);
  assert.match(cookies.get(ANALYTICS_COOKIE), /^v1\.granted\./);
  assert.ok(writes[0].includes("Secure"));
  assert.equal(setAnalyticsConsent(false), true);
  assert.equal(readAnalyticsConsent(), false);
  assert.equal(cookies.has("memo-visit"), false);
  assert.match(cookies.get(ANALYTICS_COOKIE), /^v1\.denied\./);
}));

test("blocked storage fails closed without taking down the page", () => withBrowser(true, () => {
  assert.equal(readAnalyticsConsent(), false);
  assert.equal(setAnalyticsConsent(true), false);
  assert.equal(readAnalyticsConsent(), false);
}));

test("cookie names with the same prefix cannot grant consent", () => withBrowser(false, cookies => {
  cookies.set(ANALYTICS_COOKIE + "-old", `v1.granted.${Date.now()}`);
  assert.equal(readAnalyticsConsent(), false);
}));


test("a durable withdrawal vetoes an older cookie restored by WebKit", () => withBrowser(false, cookies => {
  const now = Date.now();
  let saved = `v1.denied.${now}`;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => saved } });
  cookies.set(ANALYTICS_COOKIE, `v1.granted.${now - 1000}`);
  assert.equal(readAnalyticsConsent(), false);
  // A later explicit opt-in supersedes the old withdrawal.
  cookies.set(ANALYTICS_COOKIE, `v1.granted.${now}`);
  saved = `v1.denied.${now - 1000}`;
  assert.equal(readAnalyticsConsent(), true);
  // A saved grant cannot restore consent after cookie deletion or expiry.
  saved = `v1.granted.${now}`;
  cookies.delete(ANALYTICS_COOKIE);
  assert.equal(readAnalyticsConsent(), false);
  cookies.set(ANALYTICS_COOKIE, `v1.granted.${now - ANALYTICS_MAX_AGE * 1000}`);
  assert.equal(readAnalyticsConsent(), false);
}));

test("the iOS app is opt-in while the website counts visitors unless they opt out", async () => {
  const { analyticsAllowed } = await import("../src/lib/analytics-consent.ts");
  const now = Date.UTC(2026, 8, 23);
  const granted = `v1.granted.${now - 1000}`;
  const denied = `v1.denied.${now - 1000}`;
  assert.equal(analyticsAllowed(undefined, true, now), false, "the app starts with analytics off");
  assert.equal(analyticsAllowed(granted, true, now), true);
  assert.equal(analyticsAllowed(denied, true, now), false);
  assert.equal(analyticsAllowed(undefined, false, now), true, "the website counts visitors by default");
  assert.equal(analyticsAllowed(granted, false, now), true);
  assert.equal(analyticsAllowed(denied, false, now), false, "an explicit off is honoured on the website");
});
