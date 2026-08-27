import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADMIN_RESTORE_COOKIE,
  IMPERSONATION_COOKIE,
  IMPERSONATION_COOKIE_OPTIONS,
  encodeCookiePayload,
  parseAdminRestorePayload,
  parseImpersonationPayload,
} from "../src/lib/admin/impersonation-cookies.ts";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const START_ROUTE = read("../src/app/api/admin/impersonate/route.ts");
const STOP_ROUTE = read("../src/app/api/admin/impersonate/stop/route.ts");
const RESTORE = read("../src/lib/admin/impersonation-restore.ts");
const LOGOUT = read("../src/app/auth/logout/route.ts");

test("both impersonation cookies are server-only and first-party", () => {
  // The banner reads the state server-side precisely because client JavaScript must never see
  // whose account this is, and the restore cookie carries the admin's own tokens.
  assert.equal(IMPERSONATION_COOKIE_OPTIONS.httpOnly, true);
  assert.equal(IMPERSONATION_COOKIE_OPTIONS.sameSite, "lax");
  assert.equal(IMPERSONATION_COOKIE_OPTIONS.path, "/");
});

test("payloads survive a round trip and malformed cookies decode to null", () => {
  const restore = { accessToken: "a", refreshToken: "r", adminEmail: "admin@memo.app" };
  assert.deepEqual(parseAdminRestorePayload(encodeCookiePayload(restore)), restore);

  const state = {
    targetUserId: "user-1",
    targetEmail: "learner@example.com",
    adminEmail: "admin@memo.app",
    startedAt: "2026-08-27T00:00:00.000Z",
  };
  assert.deepEqual(parseImpersonationPayload(encodeCookiePayload(state)), state);

  // A tampered or truncated cookie must read as "not impersonating" rather than throwing.
  for (const bad of [undefined, "", "not-base64!", encodeCookiePayload({ nope: true })]) {
    assert.equal(parseAdminRestorePayload(bad), null);
    assert.equal(parseImpersonationPayload(bad), null);
  }

  // A half-written restore cookie is useless: refusing it sends the admin to a clean re-login
  // instead of a broken setSession.
  assert.equal(parseAdminRestorePayload(encodeCookiePayload({ accessToken: "a" })), null);
});

test("starting an impersonation is gated on the admin allowlist", () => {
  const guardIndex = START_ROUTE.indexOf("requireAdminApi()");
  const mintIndex = START_ROUTE.indexOf("mintImpersonationTokenHash(");

  assert.ok(guardIndex > 0, "the start route no longer checks the admin allowlist");
  assert.ok(guardIndex < mintIndex, "the allowlist must be checked before a session is minted");
  assert.match(START_ROUTE, /if \(!admin\.ok\) \{\s*return admin\.response;/);
  // The target is named by id and resolved server-side; no email or token comes from the browser.
  assert.match(START_ROUTE, /formData\?\.get\("user_id"\)/);
  assert.ok(
    !START_ROUTE.includes('get("email")'),
    "the target must be resolved server-side, never taken from the request",
  );
});

test("stopping is gated on the restore cookie, so it is inert for everyone else", () => {
  assert.match(STOP_ROUTE, /restoreAdminSession\(/);
  assert.match(RESTORE, new RegExp(`cookies\\.get\\(${ADMIN_RESTORE_COOKIE ? "ADMIN_RESTORE_COOKIE" : ""}\\)`));
  assert.match(RESTORE, /if \(!restore\) \{\s*return null;/);
});

test("logging out of an impersonated account never signs the learner out", () => {
  // signOut() defaults to global scope: reaching it while impersonating would revoke the real
  // user's sessions on their own devices. The restore must therefore come first.
  const restoreIndex = LOGOUT.indexOf("restoreAdminSession");
  const signOutIndex = LOGOUT.indexOf("auth.signOut()");

  assert.ok(restoreIndex > 0, "the logout route no longer checks for an impersonation");
  assert.ok(
    restoreIndex < signOutIndex,
    "the impersonation check must come before signOut, or the learner is signed out",
  );

  // Nothing in the impersonation paths may actually call sign-out (prose about it is fine).
  for (const source of [RESTORE, STOP_ROUTE, START_ROUTE]) {
    assert.ok(
      !/auth\.signOut\(/.test(source.replace(/`[^`]*`/g, "")),
      "impersonation must never call signOut",
    );
  }
});

test("a failed restore clears the session instead of stranding the admin as the user", () => {
  const failureBlock = RESTORE.slice(RESTORE.indexOf("if (error)"));

  assert.match(failureBlock, /startsWith\("sb-"\)/, "the stale session cookies must be cleared");
  assert.match(failureBlock, /admin\/login/, "the admin is sent to a clean login");
  assert.ok(
    failureBlock.includes("clearImpersonationCookies"),
    "the impersonation state must be cleared on a failed restore",
  );
});

test("the impersonation cookie names are distinct and namespaced", () => {
  assert.notEqual(ADMIN_RESTORE_COOKIE, IMPERSONATION_COOKIE);
  for (const name of [ADMIN_RESTORE_COOKIE, IMPERSONATION_COOKIE]) {
    assert.match(name, /^memoai-/);
    // Must not collide with the Supabase session cookies the logout sweep clears by prefix.
    assert.ok(!name.startsWith("sb-"));
  }
});

test("the banner never reads cookies from the root layout", () => {
  // Reading a cookie in the root layout opts every page out of static rendering — it took the
  // three prerendered legal pages dynamic when the slot first landed there. The app layout is
  // already dynamic, so the marker is free there and the marketing pages stay static.
  const rootLayout = read("../src/app/layout.tsx");
  const appLayout = read("../src/app/app/layout.tsx");

  assert.ok(
    !rootLayout.includes("ImpersonationBannerSlot"),
    "the impersonation banner must not mount in the root layout",
  );
  assert.ok(
    appLayout.includes("<ImpersonationBannerSlot />"),
    "the impersonation banner must mount in the app layout",
  );
});
