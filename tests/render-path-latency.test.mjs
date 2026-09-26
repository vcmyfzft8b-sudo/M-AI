import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("page renders reconcile Stripe after the response; API routes and the paywall wait", () => {
  const billing = read("../src/lib/billing.ts");
  const decide = billing.slice(billing.indexOf("async function canReconcileStripeAfterResponse"));

  // The paywall is where Checkout returns a buyer and where a stale "unpaid" sends a subscriber.
  assert.match(decide, /pathname !== getPaywallPath\(\)/);
  assert.match(decide, /!pathname\.startsWith\("\/api\/"\)/);
  // No path (no proxy) counts as "must wait", not as a page.
  assert.match(decide, /Boolean\(pathname &&/);
  // Outside a request nothing can be deferred to, so it must wait rather than throw.
  assert.match(decide, /catch \{[\s\S]*?return false;/);
  assert.match(billing, /export function getPaywallPath\(\) \{\s*return "\/app\/start";/);

  const resolve = billing.slice(billing.indexOf("async function resolveUserSubscriptionState"));
  assert.match(resolve, /if \(await canReconcileStripeAfterResponse\(\)\) \{\s*after\(\(\) => reconcileStripeSubscriptions\(/);
});

test("nobody waits on Stripe while they are still answering the survey", () => {
  const start = read("../src/app/app/start/page.tsx");
  assert.match(
    start,
    /appState\.onboardingComplete\s*\?\s*await getSubscriptionTrialEligibility\(appState\.user\.id\)\s*:\s*false/,
  );

  // The survey page never shows a price, so it never asks.
  const onboarding = read("../src/app/onboarding/page.tsx");
  assert.doesNotMatch(onboarding, /getSubscriptionTrialEligibility|getViewerCheckoutState/);
});

test("pages run beside the database; the lecture pipeline stays where it was", () => {
  const vercel = JSON.parse(read("../vercel.json"));
  assert.deepEqual(vercel.regions, ["dub1"]);

  // Vercel's Next builder drops a route's `preferredRegion`; only `functions` in vercel.json
  // places a single function elsewhere. Match each pipeline route the way the builder does:
  // the exact source path first, then the pattern as a glob.
  const pinned = Object.entries(vercel.functions ?? {})
    .filter(([, fn]) => JSON.stringify(fn.regions) === JSON.stringify(["iad1"]))
    .map(([pattern]) => pattern);
  const matches = (file) => pinned.some((pattern) => pattern === file || path.matchesGlob(file, pattern));

  const internal = readdirSync(new URL("../src/app/api/internal/lectures/", import.meta.url))
    .map((stage) => `src/app/api/internal/lectures/${stage}/route.ts`);
  assert.ok(internal.length >= 9);
  for (const route of [...internal, "src/app/api/inngest/route.ts", "src/app/api/lectures/[id]/retry/route.ts"]) {
    assert.ok(existsSync(new URL(`../${route}`, import.meta.url)), route);
    assert.ok(matches(route), `${route} is not pinned to iad1`);
  }
  // Nothing user-facing is.
  for (const route of ["src/app/api/billing/checkout/route.ts", "src/app/api/lectures/link/route.ts"]) {
    assert.ok(!matches(route), `${route} should run beside the database`);
  }

  // A segment-config pin would look like it works (Next records it) and would not.
  for (const route of internal) assert.doesNotMatch(read(`../${route}`), /preferredRegion/);
});
