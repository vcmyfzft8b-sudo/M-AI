import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Where offline is allowed to say anything at all.
 *
 * The rule is a design decision, not an accident: there is no standing "you are
 * offline" chrome anywhere in this app. Being offline is not news to somebody
 * who is offline — it is a thing to find out at the one moment it matters, on
 * the tab that needs a live voice or the button that needs a server. A banner
 * across every screen was built first and taken out again, and this is what
 * keeps it out.
 *
 * The other half is the gates themselves: an online-only surface must refuse
 * before it acts, not fail afterwards with whatever the engine calls a dropped
 * connection ("Load failed" in Safari, which is English and reads as a crash).
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");

const workspace = read("src/components/lecture-workspace.tsx");
const home = read("src/components/home-dashboard.tsx");

test("no screen wears a standing offline banner", () => {
  for (const file of [
    "src/app/app/layout.tsx",
    "src/components/app-shell.tsx",
    "src/components/offline/offline-app.tsx",
    "src/components/offline/offline-notice.tsx",
  ]) {
    assert.doesNotMatch(
      read(file),
      /OfflineBanner|memo-offline-bar/,
      `${file} must not reintroduce a global offline bar`,
    );
  }
});

test("the live tabs refuse before they open, rather than failing inside", () => {
  for (const tab of ["tutor", "podcast"]) {
    assert.match(
      workspace,
      new RegExp(`isOffline && activeTab === "${tab}"`),
      `the ${tab} tab must answer with the offline notice`,
    );
  }
});

test("the chat composer is closed rather than left to swallow a question", () => {
  assert.match(
    workspace,
    /chatLimitReached \|\| isOffline/,
    "an unanswerable question must not be able to land in the log",
  );
  assert.match(workspace, /if \(isOffline\) \{\s*setChatError/);
});

test("making a note is blocked before the entitlement check, not after", () => {
  /*
   * Order matters: offline the upgrade screen is just as unreachable as the
   * capture sheet, so answering "you cannot make a note" by sending somebody to
   * a screen that cannot load is worse than saying why.
   */
  const guard = home.indexOf('blockedOffline("create")');
  const paywall = home.indexOf("if (!canCreateNotes)");

  assert.ok(guard > -1 && paywall > -1);
  assert.ok(guard < paywall, "the offline guard must come first");
});

test("everything the reader already has stays reachable offline", () => {
  /*
   * The point of the whole feature. These tabs render from the snapshot the
   * note screen was given, so none of them may be gated on a connection.
   */
  for (const tab of ["flashcards", "quiz", "test", "speed", "transcript", "notes"]) {
    assert.doesNotMatch(
      workspace,
      new RegExp(`isOffline && activeTab === "${tab}"`),
      `${tab} is in the snapshot and must work with no connection`,
    );
  }
});

test("the offline stub refuses everything it cannot answer, with a reason", () => {
  const api = read("src/lib/offline/api.ts");

  assert.match(api, /code: OFFLINE_ERROR_CODE/);
  assert.match(api, /503/, "a refusal, so the screens' own error paths show it");
  assert.match(
    api,
    /t\("offline\.requestBlocked"\)/,
    "translated, rather than whatever the engine calls a dropped connection",
  );
});

test("the offline copy is per account and dropped when the account changes", () => {
  const snapshot = read("src/lib/offline/snapshot.ts");

  assert.match(snapshot, /export async function ensureOfflineOwner/);
  assert.match(snapshot, /meta\.userId !== userId[\s\S]{0,80}clearOfflineSnapshots\(\)/);
});

test("only a finished note is cached", () => {
  /*
   * One still being transcribed would be kept as a progress screen that can
   * never progress — a spinner with no connection behind it.
   */
  assert.match(
    read("src/components/offline/offline-capture.tsx"),
    /detail\.lecture\.status !== "ready"/,
  );
});
