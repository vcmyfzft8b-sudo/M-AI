import assert from "node:assert/strict";
import test from "node:test";

import {
  detectInstallPlatform,
  INSTALL_GUIDE_SEEN_EVENT,
  markInstallGuideSeen,
  shouldOfferInstallGuide,
} from "../src/lib/install-guide.ts";

/**
 * The red dot on the settings gear, and on the row it points at.
 *
 * The rule it has to obey is one sentence: every account is owed one look at
 * the home screen guide, and opening it is the only thing that ends that. The
 * cases below are the ones that got it wrong before — an account that had
 * never opened it seeing nothing because of where the app happened to be
 * running from, and an answer that did not survive the second device.
 */

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPAD_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

/**
 * A browser, as much of one as this module touches.
 *
 * `standalone` and `displayMode` describe an app opened from the home screen —
 * the state the user was in when the badge failed to appear for an account
 * that had never seen it.
 */
function stubBrowser({
  userAgent = IPHONE_UA,
  maxTouchPoints = 5,
  standalone = false,
  displayMode = "browser",
  stored = null,
  storageThrows = false,
} = {}) {
  const events = [];
  const writes = [];

  const storage = {
    getItem() {
      if (storageThrows) {
        throw new Error("The operation is insecure.");
      }

      return stored;
    },
    setItem(key, value) {
      if (storageThrows) {
        throw new Error("The operation is insecure.");
      }

      writes.push([key, value]);
      stored = value;
    },
  };

  const navigatorStub = { userAgent, maxTouchPoints, standalone };

  // Node defines `navigator` as a getter of its own, so it has to be replaced
  // rather than assigned to.
  Object.defineProperty(globalThis, "navigator", {
    value: navigatorStub,
    configurable: true,
    writable: true,
  });

  globalThis.window = {
    navigator: navigatorStub,
    localStorage: storage,
    matchMedia: (query) => ({
      matches: query.includes("standalone") && displayMode === "standalone",
    }),
    dispatchEvent: (event) => events.push(event.type),
  };

  return { events, writes };
}

test.afterEach(() => {
  delete globalThis.window;
  delete globalThis.navigator;
  delete globalThis.fetch;
});

test("an account that has never opened the guide is badged", () => {
  stubBrowser();

  assert.equal(shouldOfferInstallGuide(false), true);
});

test("the badge survives the app already being on the home screen", () => {
  // The reported case: an account made before the badge existed, opening the
  // app from its home screen icon, seeing no dot. Standalone is a fact about
  // the window; the guide is owed to the person.
  stubBrowser({ standalone: true, displayMode: "standalone" });

  assert.equal(shouldOfferInstallGuide(false), true, "installed must not silence the badge");
});

test("opening the guide ends it, on every device", () => {
  // A second phone: nothing in this browser's storage, and it still must not
  // be offered, because the account already answered.
  stubBrowser({ stored: null });

  assert.equal(shouldOfferInstallGuide(true), false);
});

test("a browser that was already answered stays quiet", () => {
  // The local echo, for the gap where the account write never landed.
  stubBrowser({ stored: "true" });

  assert.equal(shouldOfferInstallGuide(false), false);
});

test("storage that refuses to answer does not cost the badge", () => {
  stubBrowser({ storageThrows: true });

  assert.equal(shouldOfferInstallGuide(false), true);
});

test("the badge is a phone thing", () => {
  stubBrowser({ userAgent: IPHONE_UA });
  assert.equal(detectInstallPlatform(), "ios");

  stubBrowser({ userAgent: ANDROID_UA });
  assert.equal(detectInstallPlatform(), "android");

  // iPadOS has called itself a Mac since 13; the touch points give it away.
  stubBrowser({ userAgent: IPAD_UA, maxTouchPoints: 5 });
  assert.equal(detectInstallPlatform(), "ios");

  // A real Mac has no home screen, and the settings row it points at is not
  // drawn there either.
  stubBrowser({ userAgent: MAC_UA, maxTouchPoints: 0 });
  assert.equal(detectInstallPlatform(), "other");
});

test("opening the guide answers the account once and both badges at once", async () => {
  const { events, writes } = stubBrowser();
  const posts = [];

  globalThis.fetch = (url, init) => {
    posts.push(`${init?.method} ${url}`);
    return Promise.resolve({ ok: true });
  };

  markInstallGuideSeen();
  // Opening it twice is easy — the row is still there when the sheet closes.
  markInstallGuideSeen();

  await Promise.resolve();

  assert.deepEqual(posts, ["POST /api/install-guide"], "the account is told once");
  assert.equal(writes.length, 2, "the local echo is written each time");
  assert.deepEqual(
    events,
    [INSTALL_GUIDE_SEEN_EVENT, INSTALL_GUIDE_SEEN_EVENT],
    "the gear and the row both hear about it",
  );
  assert.equal(shouldOfferInstallGuide(false), false, "and the badge is gone");
});
