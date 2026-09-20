import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { needsDocumentNavigation } from "../src/lib/offline/paths.ts";

/**
 * Leaving the cached shell.
 *
 * The shell is a copy of the app: rendered at `/offline`, served under whatever
 * address was asked for, and drawn from a snapshot rather than from the
 * account. It says no note can be created whatever the account is entitled to,
 * which is the right answer with no connection and the wrong one the moment
 * the connection comes back — the probe flips the app back online and leaves
 * the copy on screen. A paid account that then taps create was sent, through
 * the router, to the upgrade screen, which redirected it back to the address
 * the shell was already on; the two bounced until WebKit refused the hundredth
 * `replaceState` in ten seconds and took the app with it.
 *
 * So: the shell is left through the document, whether or not the network is
 * back.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");

const base = {
  href: "/app/start",
  isOffline: false,
  isShell: false,
  inCreatorDemo: false,
  hasServiceWorker: true,
};

test("the shell is left through the document once the connection is back", () => {
  assert.equal(
    needsDocumentNavigation({ ...base, isShell: true }),
    true,
    "a tap in the shell must not be routed on by a client-side navigation",
  );
});

test("a real page online still routes client-side", () => {
  assert.equal(needsDocumentNavigation(base), false);
});

test("offline, every page leaves through the document, shell or not", () => {
  assert.equal(needsDocumentNavigation({ ...base, isOffline: true }), true);
  assert.equal(needsDocumentNavigation({ ...base, isOffline: true, isShell: true }), true);
});

test("offline with no worker in front of it, nothing can answer a document request", () => {
  assert.equal(
    needsDocumentNavigation({ ...base, isOffline: true, isShell: true, hasServiceWorker: false }),
    false,
  );
});

test("the demo keeps its in-memory library", () => {
  assert.equal(needsDocumentNavigation({ ...base, isShell: true, inCreatorDemo: true }), false);
  assert.equal(needsDocumentNavigation({ ...base, isOffline: true, inCreatorDemo: true }), false);
});

test("an external link is the browser's business", () => {
  assert.equal(
    needsDocumentNavigation({ ...base, href: "https://memoai.eu/app", isShell: true }),
    false,
  );
});

test("the navigation path asks, rather than deciding for itself", () => {
  const navigation = read("src/components/navigation-loading.tsx");

  assert.match(
    navigation,
    /needsDocumentNavigation\(\{[\s\S]*?isShell: isShellNow\(\)/,
    "navigateWithFeedback must take the shell into account, not just the connection",
  );
  assert.doesNotMatch(
    navigation,
    /if \(\s*isOfflineNow\(\) &&/,
    "the old connection-only rule would route on from the shell again",
  );
});

test("the provider keeps the shell mirror in step for the code outside React", () => {
  const provider = read("src/components/offline/offline-provider.tsx");

  assert.match(provider, /export function isShellNow\(\)/);
  assert.match(provider, /setShellNow\(isShell\);/, "written during render, like the offline one");
});

test("an unentitled tap on the home screen goes through the navigation path", () => {
  const home = read("src/components/home-dashboard.tsx");

  assert.doesNotMatch(
    home,
    /if \(!canCreateNotes\) \{\s*router\.(push|replace)\(startHref\)/,
    "the upgrade screen must be reached through navigateWithFeedback, which knows about the shell",
  );
  assert.match(
    home,
    /if \(!canCreateNotes\) \{\s*navigateDashboardWithFeedback\(startHref\);/,
  );
});
