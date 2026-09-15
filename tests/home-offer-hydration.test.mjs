import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The home screen hydrating for a buyer who is on their way back from Stripe.
 *
 * The offer sheet is put back by reading `sessionStorage` during render, which
 * the server has no way to do. Seeding the state that way is fine; rendering
 * from it on the first client pass is not. That pass is checked against HTML
 * the server built without the note, so the deferred offer it puts on screen —
 * a lazy surface, its Suspense boundary, and the bar that stands in while the
 * chunk downloads — is a whole surface the server never sent, and React answers
 * by discarding the streamed-in home screen and drawing it again.
 *
 * There is no DOM in the test runner, so the rule that breaks is written out
 * below rather than driven through react-dom: the client pass claims what the
 * server sent, in order, and anything left over is the mismatch. Both renders
 * are played through it, seeded and hydration-gated, which is the whole of the
 * fix. Nothing about it is visible: the sheet is portalled, so it was never
 * going to draw before hydration anyway.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/**
 * React hydrating one parent's children: everything the client renders has to
 * come out of what the server sent, in the same order. A client node with
 * nothing left to claim is `Hydration failed`, which is what production
 * reported — React error #418.
 */
function hydrateChildren(serverChildren, clientChildren) {
  let claimed = 0;

  for (const child of clientChildren) {
    if (claimed >= serverChildren.length) {
      throw new Error(`Hydration failed because the server sent no ${child} to hydrate.`);
    }

    assert.equal(
      serverChildren[claimed],
      child,
      "the client claimed something the server had put somewhere else",
    );
    claimed += 1;
  }

  return claimed;
}

/**
 * What `HomeDashboard` puts inside `<main>`.
 *
 * `offerResumed` is the `sessionStorage` note left behind before the trip to
 * checkout: false on the server, which cannot read it, and true on the client
 * that wrote it. `hydrationGated` is the fix — whether the deferred offer is
 * held back until the pass that has to match the server is over.
 */
function renderHomeScreen({ offerResumed, hydrationGated, hydrated = false }) {
  const children = ["home screen", "desktop ask bar"];

  if (offerResumed && (hydrated || !hydrationGated)) {
    children.push("deferred offer");
  }

  return children;
}

test("rendering the resumed offer during hydration loses the home screen", () => {
  const server = renderHomeScreen({ offerResumed: false, hydrationGated: false });
  const client = renderHomeScreen({ offerResumed: true, hydrationGated: false });

  assert.throws(
    () => hydrateChildren(server, client),
    /Hydration failed because the server sent no deferred offer to hydrate\./,
  );
});

test("holding it until after hydration leaves the streamed home screen alone", () => {
  const server = renderHomeScreen({ offerResumed: false, hydrationGated: true });
  const client = renderHomeScreen({ offerResumed: true, hydrationGated: true });

  assert.equal(hydrateChildren(server, client), server.length);

  // And the offer still arrives, on the very next pass.
  const settled = renderHomeScreen({ offerResumed: true, hydrationGated: true, hydrated: true });

  assert.deepEqual(settled, ["home screen", "desktop ask bar", "deferred offer"]);
});

test("a home screen with no offer to resume hydrates either way", () => {
  for (const hydrationGated of [false, true]) {
    const server = renderHomeScreen({ offerResumed: false, hydrationGated });
    const client = renderHomeScreen({ offerResumed: false, hydrationGated });

    assert.equal(hydrateChildren(server, client), server.length);
  }
});

test("the home screen renders nothing from storage until it has hydrated", () => {
  const dashboard = read("../src/components/home-dashboard.tsx");

  // The seed is the behaviour being protected, not the bug: opening the sheet
  // from an effect would draw the home screen without it for a frame first.
  assert.match(dashboard, /searchParams\.get\("offer"\) === "1" \|\| isOfferResumePending\(\)/);
  assert.match(dashboard, /useState\(\(\) => isOfferResumed\)/);

  assert.match(
    dashboard,
    /const isHydrated = useIsHydrated\(\);/,
    "the home screen must know when the pass that has to match the server is over",
  );
  assert.match(
    dashboard,
    /\{isHydrated && \(isWheelOpen \|\| \(!native && isOfferOpen\) \|\| \(native && isOfferOpen && nativeHalfOffAvailable\)\) \? \(/,
    "the deferred offer must not be rendered on the pass that has to match the server",
  );
});

test("the hydration gate is false for exactly as long as hydration lasts", () => {
  const portal = read("../src/components/viewport-portal.tsx");

  assert.match(portal, /export function useIsHydrated\(\)/);
  assert.match(portal, /function getServerSnapshot\(\) \{\s*return false;\s*\}/);
  assert.match(portal, /function getClientSnapshot\(\) \{\s*return true;\s*\}/);
  // `useSyncExternalStore` is what makes this safe: React reads the server
  // snapshot on the hydrating pass too, so the gate cannot open early.
  assert.match(
    portal,
    /useSyncExternalStore\(subscribeToHydration, getClientSnapshot, getServerSnapshot\)/,
  );
});
