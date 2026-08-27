import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADMIN_RESTORE_COOKIE,
  IMPERSONATION_COOKIE,
  IMPERSONATION_COOKIE_OPTIONS,
  parseAdminRestorePayload,
  parseImpersonationPayload,
  signCookiePayload,
} from "../src/lib/admin/impersonation-cookies.ts";

const SECRET = "test-signing-secret";

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
  assert.deepEqual(parseAdminRestorePayload(signCookiePayload(restore, SECRET), SECRET), restore);

  const state = {
    targetUserId: "user-1",
    targetEmail: "learner@example.com",
    adminEmail: "admin@memo.app",
    startedAt: "2026-08-27T00:00:00.000Z",
  };
  assert.deepEqual(parseImpersonationPayload(signCookiePayload(state, SECRET), SECRET), state);

  // A tampered or truncated cookie must read as "not impersonating" rather than throwing.
  for (const bad of [undefined, "", "not-base64!", signCookiePayload({ nope: true }, SECRET)]) {
    assert.equal(parseAdminRestorePayload(bad, SECRET), null);
    assert.equal(parseImpersonationPayload(bad, SECRET), null);
  }

  // A half-written restore cookie is useless: refusing it sends the admin to a clean re-login
  // instead of a broken setSession.
  assert.equal(
    parseAdminRestorePayload(signCookiePayload({ accessToken: "a" }, SECRET), SECRET),
    null,
  );
});

test("a forged or tampered cookie is refused, whatever it claims", () => {
  // This is the property the whole feature rests on. Sign-out consults the restore cookie before
  // it clears anything, so an unsigned payload would turn the sign-out button into a
  // sign-in-as-attacker button for anyone able to write a cookie on the origin.
  const attacker = { accessToken: "attacker", refreshToken: "attacker", adminEmail: "evil@x" };

  // Unsigned, the shape the payload used to have.
  const unsigned = Buffer.from(JSON.stringify(attacker), "utf8").toString("base64url");
  assert.equal(parseAdminRestorePayload(unsigned, SECRET), null);

  // Signed with the wrong key.
  assert.equal(
    parseAdminRestorePayload(signCookiePayload(attacker, "not-the-secret"), SECRET),
    null,
  );

  // Body swapped underneath a valid signature.
  const genuine = signCookiePayload({ accessToken: "a", refreshToken: "r" }, SECRET);
  const swapped = `${unsigned}.${genuine.slice(genuine.lastIndexOf(".") + 1)}`;
  assert.equal(parseAdminRestorePayload(swapped, SECRET), null);

  // Signature stripped entirely.
  assert.equal(parseAdminRestorePayload(genuine.split(".")[0], SECRET), null);

  // And the same for the state cookie, so nobody can paint a fake "Viewing as" badge.
  const fakeState = { targetUserId: "victim", targetEmail: "someone@else" };
  const unsignedState = Buffer.from(JSON.stringify(fakeState), "utf8").toString("base64url");
  assert.equal(parseImpersonationPayload(unsignedState, SECRET), null);
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

test("stopping is inert unless a signed impersonation is in progress", () => {
  assert.match(STOP_ROUTE, /restoreAdminSession\(/);
  // Null is returned only when NEITHER cookie is present — i.e. nothing to stop.
  assert.match(RESTORE, /if \(!impersonating && !restore\) \{\s*return null;/);
});

test("an impersonation with no way back is force-ended, never left running", () => {
  // The dangerous shape: impersonating, restore cookie gone. Stop used to do nothing, leaving the
  // admin signed in as the learner — and the sign-out that would follow is a GLOBAL revoke of
  // that learner's own devices. The only safe answer is to end the session here.
  const forcedBranch = RESTORE.slice(RESTORE.indexOf("if (!restore)"));

  assert.match(forcedBranch, /clearEverything\(params\.request, "\/admin\/login"\)/);
  assert.match(
    RESTORE,
    /function clearEverything[\s\S]*startsWith\("sb-"\)[\s\S]*clearImpersonationCookies/,
    "force-ending must clear the session cookies as well as the impersonation state",
  );
});

test("leaving revokes the session it minted, scoped to that session alone", () => {
  // 'local' scope ends exactly this session. Global would revoke the learner's own devices.
  assert.match(RESTORE, /auth\.admin\.signOut\(accessToken, "local"\)/);
  const revokeIndex = RESTORE.indexOf("await revokeImpersonatedSession");
  assert.ok(revokeIndex > 0 && revokeIndex < RESTORE.indexOf("if (!restore)"));
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

  // Nothing in the impersonation paths may call the GLOBAL sign-out. The admin API's
  // session-scoped signOut(jwt, "local") is the one permitted form.
  for (const source of [RESTORE, STOP_ROUTE, START_ROUTE]) {
    assert.ok(
      !/auth\.signOut\(/.test(source.replace(/`[^`]*`/g, "")),
      "impersonation must never call the client signOut",
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

test("an admin cannot open another admin's account", () => {
  // Lateral movement between admin accounts is not debugging, and from that point every action
  // would be recorded as the other admin's.
  assert.match(START_ROUTE, /isAdminAccount\(target\.email\)/);
  assert.match(START_ROUTE, /impersonation=admin-target/);

  const guard = read("../src/lib/admin/impersonation.ts");
  const body = guard.slice(guard.indexOf("export async function isAdminAccount"));
  assert.match(
    body,
    /return Boolean\(error\) \|\| Boolean\(data\)/,
    "an unreadable allowlist must be treated as 'might be an admin'",
  );
  // The email is escaped before it becomes a LIKE pattern.
  assert.match(body, /replace\(/);
});
