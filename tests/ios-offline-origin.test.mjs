import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The one origin the wrapper may open.
 *
 * `memoai.eu` is the canonical domain and answers every request with a 307 to
 * `www`, so the app always *ended up* on `www` — it just arrived by redirect,
 * and nothing cared. Offline mode cares: a service worker belongs to exactly
 * one origin, the app's is `www`'s, and a launch with no connection was still
 * asking for the apex. Nothing is registered there, so nothing could intercept
 * the navigation and the reader got the native "could not connect" screen with
 * a whole cached library sitting behind it. It shipped that way once.
 *
 * So: the origin the app opens must be the origin that serves, and the apex —
 * still trusted, because a link may name it — must never be navigated to.
 */

const source = readFileSync(
  fileURLToPath(new URL("../ios/MemoAI/AppConfiguration.swift", import.meta.url)),
  "utf8",
);
const controller = readFileSync(
  fileURLToPath(new URL("../ios/MemoAI/WebViewController.swift", import.meta.url)),
  "utf8",
);
const infoPlist = readFileSync(
  fileURLToPath(new URL("../ios/MemoAI/Info.plist", import.meta.url)),
  "utf8",
);

test("the app opens the host that serves, not the one that redirects", () => {
  assert.match(
    source,
    /static let productionOrigin = URL\(string: "https:\/\/www\.memoai\.eu"\)!/,
    "the apex 307s to www; opening it leaves the service worker's origin",
  );
  assert.match(source, /static let productionApex = URL\(string: "https:\/\/memoai\.eu"\)!/);
});

test("the canonical domain stays trusted, so a link to it is not treated as leaving", () => {
  assert.match(source, /\[productionOrigin, productionApex\]/);
});

test("a main-frame navigation to the apex is rewritten rather than followed", () => {
  assert.match(
    controller,
    /url\.host == AppConfiguration\.productionApex\.host, main/,
    "otherwise an in-app link to the canonical domain strands the app off-scope",
  );
  assert.match(controller, /parts\.host = AppConfiguration\.productionOrigin\.host/);
});

/*
 * Both halves of the app-bound requirement. WKWebView runs a service worker
 * only for a domain in this list, and only when the web view opts into the
 * restriction — with either missing the page never even requests `/sw.js`.
 */
test("both production hosts are app-bound, and the web view opts in", () => {
  for (const host of ["memoai.eu", "www.memoai.eu"]) {
    assert.ok(
      infoPlist.includes(`<string>${host}</string>`),
      `${host} must be in WKAppBoundDomains`,
    );
  }

  assert.match(infoPlist, /<key>WKAppBoundDomains<\/key>/);
  assert.match(
    controller,
    /config\.limitsNavigationsToAppBoundDomains = AppConfiguration\.isAppBound/,
  );
  assert.match(source, /static var isAppBound: Bool/);
});

test("every app-bound host the wrapper can open is in the plist", () => {
  const listed = [...source.matchAll(/"((?:www\.)?memoai\.eu|localhost)"/g)].map((m) => m[1]);

  for (const host of new Set(listed)) {
    assert.ok(
      infoPlist.includes(`<string>${host}</string>`),
      `${host} is treated as app-bound in Swift but is not in WKAppBoundDomains`,
    );
  }
});

/*
 * The launch screen is the mark alone, held still on the app's own canvas —
 * the same mark, in the same place, as the launch image iOS shows before the
 * process is running, so the handover between the two is invisible. A throbber
 * underneath it was the one thing on screen that moved, and it announced
 * "loading" over a screen whose whole job is to look like the app has opened.
 */
test("the launch screen has no spinner on it", () => {
  assert.doesNotMatch(
    controller,
    /UIActivityIndicatorView|startAnimating/,
    "the launch is the mark alone; nothing on it may move",
  );
});

test("the failure stack starts hidden, so nothing shows under the mark while it loads", () => {
  const build = controller.slice(
    controller.indexOf("private func buildOverlay()"),
    controller.indexOf("@objc private func reload()"),
  );

  assert.ok(build.length > 0, "buildOverlay has moved; re-check this assertion");
  assert.match(build, /overlay\.isHidden = true/);
});
