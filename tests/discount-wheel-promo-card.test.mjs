import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Which promo card the home screen draws after a trip to the upgrade screen.
 *
 * The slot holds one of two cards — the gift while the wheel has a spin left,
 * the plain upgrade once it does not — and which one is decided on the server
 * and arrives with the page. The router keeps a rendered page in memory for a
 * minute (`staleTimes` in next.config.ts), so opening the upgrade screen and
 * closing it again is a navigation between two pages this tab already has:
 * what draws is the copy taken before the spin. That copy says the wheel is
 * free, so the gift comes back for as long as it takes `/api/discount-wheel`
 * to answer, and is then swapped for the upgrade card.
 *
 * The session flag that hides the gift between the spin and the server
 * catching up cannot help: it belongs to the mount that spun, and coming back
 * is a new one. The router's copy has to be thrown away instead.
 *
 * There is no DOM here, so the rule is played out below rather than driven
 * through the component: a cached page, a spin, a navigation away and back,
 * and the frames the slot draws on the way back.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** The card the slot holds for a given answer, as the home screen picks it. */
function promoCard({ canSpin, claimedThisMount }) {
  if (canSpin === null) {
    return "none";
  }

  return canSpin && !claimedThisMount ? "gift" : "upgrade";
}

/**
 * A tab with a router that keeps rendered pages, and a wheel on the server.
 *
 * `dropsStalePageOnSpin` is the fix: whether taking the spin discards the copy
 * the router is holding, so the next visit is rendered fresh.
 */
function openHomeScreen({ dropsStalePageOnSpin }) {
  const server = { spun: false };
  let cached = null;
  const frames = [];

  /** Rendering the home screen, from the router's copy when it has one. */
  function visit() {
    if (cached === null) {
      cached = { canSpin: !server.spun };
    }

    // The mount that draws it has no session flag of its own yet.
    let claimedThisMount = false;

    frames.push(promoCard({ canSpin: cached.canSpin, claimedThisMount }));

    return {
      spin() {
        server.spun = true;
        claimedThisMount = true;

        if (dropsStalePageOnSpin) {
          cached = null;
        }

        frames.push(promoCard({ canSpin: cached?.canSpin ?? !server.spun, claimedThisMount }));
      },
      /** What `/api/discount-wheel` reports once it answers, after mount. */
      settle() {
        frames.push(promoCard({ canSpin: !server.spun, claimedThisMount }));
      },
      leave() {
        // The upgrade screen is another page; the slot is not on it.
        frames.push("none");
      },
    };
  }

  return { visit, frames };
}

test("the copy kept for the way back offers a prize that has been spent", () => {
  const home = openHomeScreen({ dropsStalePageOnSpin: false });

  const first = home.visit();
  first.settle();
  first.spin();
  first.leave();

  const second = home.visit();
  second.settle();

  assert.deepEqual(home.frames, [
    "gift", // the wheel has a spin left
    "gift",
    "upgrade", // spun: the session flag hides the gift straight away
    "none", // the upgrade screen
    "gift", // ...and back, drawn from the copy taken before the spin
    "upgrade", // corrected once the server answers. This swap is the bug.
  ]);
});

test("dropping that copy leaves the upgrade card in place from the first frame", () => {
  const home = openHomeScreen({ dropsStalePageOnSpin: true });

  const first = home.visit();
  first.settle();
  first.spin();
  first.leave();

  const second = home.visit();
  second.settle();

  assert.deepEqual(home.frames, ["gift", "gift", "upgrade", "none", "upgrade", "upgrade"]);
  assert.equal(
    home.frames.slice(4).includes("gift"),
    false,
    "the gift must not come back after the spin",
  );
});

test("a wheel nobody has spun still gets its card either way", () => {
  for (const dropsStalePageOnSpin of [false, true]) {
    const home = openHomeScreen({ dropsStalePageOnSpin });

    const first = home.visit();
    first.settle();
    first.leave();

    const second = home.visit();
    second.settle();

    assert.deepEqual(home.frames, ["gift", "gift", "none", "gift", "gift"]);
  }
});

test("the home screen drops the router's copy when the spin is taken", () => {
  const dashboard = read("../src/components/home-dashboard.tsx");

  assert.match(
    dashboard,
    /if \(!hasClaimedDiscount\) \{\s*return;\s*\}\s*router\.refresh\(\);/,
    "taking the spin must discard the page rendered before it",
  );
});

test("it drops the copy again when the server disagrees with the page", () => {
  const dashboard = read("../src/components/home-dashboard.tsx");

  // A spin taken on another device, or the day turning over: the page was
  // rendered from an answer that has since changed, so the copy of it the
  // router is holding is wrong in the same way.
  assert.match(
    dashboard,
    /if \(initialCanSpinWheel !== null && available !== initialCanSpinWheel\) \{\s*router\.refresh\(\);/,
    "a page that disagrees with the server must not be kept for the way back",
  );
});

test("the router really is keeping pages, which is what makes this possible", () => {
  const config = read("../next.config.ts");

  assert.match(config, /staleTimes: \{\s*dynamic: \d+,/);
});
