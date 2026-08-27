import assert from "node:assert/strict";
import test from "node:test";

import {
  LINK_LOGIN_WALL_CODE,
  LINK_LOGIN_WALL_MESSAGE,
  isLoginWallUrl,
  looksLikeLoginPage,
} from "../src/lib/link-login-walls.ts";

// The exact import production failed on: a Moodle resource link, which answers an
// unauthenticated fetch with 303 -> /login/index.php. The login page comes back as a
// healthy 200 whose readable text is 38 characters, so the learner was told the page was
// too thin to summarise instead of being told to sign in.
test("recognises the Moodle login redirect that reached production", () => {
  assert.equal(
    isLoginWallUrl("https://eucilnica.almamater.si/login/index.php"),
    true,
  );
});

test("does not flag the resource link itself — only where it leads", () => {
  // The pasted URL looks perfectly ordinary; the redirect is the whole signal, which is
  // why the check has to run over the chain rather than over the learner's input.
  assert.equal(
    isLoginWallUrl("https://eucilnica.almamater.si/mod/resource/view.php?id=82628"),
    false,
  );
});

test("matches whole path segments, so ordinary pages about logging in are safe", () => {
  assert.equal(isLoginWallUrl("https://example.com/blog/login-security"), false);
  assert.equal(isLoginWallUrl("https://example.com/how-to-sign-in-faster"), false);
  assert.equal(isLoginWallUrl("https://example.com/authors/jane"), false);
  assert.equal(isLoginWallUrl("https://example.com/authorization-theory"), false);
});

test("catches the identity providers a campus link hands off to", () => {
  assert.equal(
    isLoginWallUrl("https://login.microsoftonline.com/common/oauth2/v2.0/authorize"),
    true,
  );
  assert.equal(isLoginWallUrl("https://accounts.google.com/o/saml2/idp"), true);
  assert.equal(isLoginWallUrl("https://wayf.aai.arnes.si/WAYF/index.php"), true);
});

test("matches an identity provider only as the host or its parent domain", () => {
  // A lookalike host must not inherit the provider's meaning.
  assert.equal(isLoginWallUrl("https://notaccounts.google.com.evil.test/x"), false);
  assert.equal(isLoginWallUrl("https://okta.com.attacker.test/login-page"), false);
});

test("common login routes and script names are covered", () => {
  assert.equal(isLoginWallUrl("https://example.com/wp-login.php"), true);
  assert.equal(isLoginWallUrl("https://example.com/users/sign_in"), true);
  assert.equal(isLoginWallUrl("https://example.com/cas/login?service=x"), true);
  assert.equal(isLoginWallUrl("https://example.com/Login/Index.aspx"), true);
});

test("an unparseable value is not a login wall", () => {
  assert.equal(isLoginWallUrl("not a url"), false);
  assert.equal(isLoginWallUrl(""), false);
});

test("a password field identifies a sign-in form served at the pasted URL", () => {
  // Some sites render the form in place rather than redirecting, so there is no chain to
  // inspect — the markup is the only tell.
  assert.equal(
    looksLikeLoginPage('<form><input type="password" name="password"></form>'),
    true,
  );
  assert.equal(looksLikeLoginPage("<input type=password>"), true);
  assert.equal(looksLikeLoginPage("<INPUT TYPE='PASSWORD'>"), true);
});

test("an ordinary article is not mistaken for a sign-in form", () => {
  assert.equal(
    looksLikeLoginPage("<article><p>Password managers are useful.</p></article>"),
    false,
  );
  assert.equal(looksLikeLoginPage('<input type="text" name="password_hint">'), false);
  assert.equal(looksLikeLoginPage(""), false);
});

test("the learner-facing message names the cause and the way out", () => {
  assert.equal(LINK_LOGIN_WALL_CODE, "link_requires_login");
  // The message is what lands in the red panel on the dashboard, so it has to be
  // Slovenian like the rest of that surface, and it has to point somewhere other than
  // the retry button, which can never clear a sign-in wall.
  assert.match(LINK_LOGIN_WALL_MESSAGE, /prijava/i);
  assert.match(LINK_LOGIN_WALL_MESSAGE, /naloži/i);
  assert.ok(!/[a-z]{3,} the [a-z]{3,}/i.test(LINK_LOGIN_WALL_MESSAGE));
});
