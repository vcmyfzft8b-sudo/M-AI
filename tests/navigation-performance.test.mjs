import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseVerifiedPageUser,
  serializeVerifiedPageUser,
} from "../src/lib/verified-page-user.ts";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("the proxy authentication handoff preserves the page identity", () => {
  const user = {
    id: "6ca1f0f0-4a5f-4b0a-9a3a-9a6d1b0d1e01",
    email: "student@example.com",
    email_confirmed_at: "2026-08-01T10:00:00.000Z",
    confirmed_at: "2026-08-01T10:00:00.000Z",
    user_metadata: {
      full_name: "Živa Študentka",
      name: "Živa",
      email: "student@example.com",
      ignored_large_field: "not copied into a request header",
    },
  };

  const serialized = serializeVerifiedPageUser(user);
  const parsed = parseVerifiedPageUser(serialized);

  assert.ok(parsed);
  assert.equal(parsed.id, user.id);
  assert.equal(parsed.email, user.email);
  assert.equal(parsed.email_confirmed_at, user.email_confirmed_at);
  assert.deepEqual(parsed.user_metadata, {
    full_name: "Živa Študentka",
    name: "Živa",
    email: "student@example.com",
  });
  assert.ok(!serialized.includes("Živa"), "the request header must stay ASCII-safe");
});

test("malformed authentication handoffs are ignored", () => {
  for (const value of [null, "", "%not-json", encodeURIComponent("{}")]) {
    assert.equal(parseVerifiedPageUser(value), null);
  }
});

test("a browser cannot forge the proxy authentication handoff", () => {
  const middleware = read("../src/lib/supabase/middleware.ts");
  const deleteIndex = middleware.indexOf(
    "requestHeaders.delete(VERIFIED_PAGE_USER_HEADER)",
  );
  const apiReturnIndex = middleware.indexOf('request.nextUrl.pathname.startsWith("/api/")');
  const validationIndex = middleware.indexOf("await supabase.auth.getUser()");
  const setIndex = middleware.indexOf("serializeVerifiedPageUser(user)");

  assert.ok(deleteIndex > 0, "incoming private headers must be removed");
  assert.ok(deleteIndex < apiReturnIndex, "API handlers must never inherit the private header");
  assert.ok(validationIndex < setIndex, "only a Supabase-validated user may be handed to a page");
});

test("the home screen keeps heavyweight interaction surfaces out of its initial bundle", () => {
  const dashboard = read("../src/components/home-dashboard.tsx");

  assert.doesNotMatch(
    dashboard,
    /import \{ NoteSourceModal[^;]+from "@\/components\/note-source-modal"/,
  );
  assert.doesNotMatch(
    dashboard,
    /import \{ DiscountOffer[^;]+from "@\/components\/discount-offer"/,
  );
  assert.match(dashboard, /dynamic\([\s\S]*loadNoteSourceModal/);
  assert.match(dashboard, /dynamic\([\s\S]*loadDiscountOffer/);
});

test("ordinary app state no longer waits on Stripe trial-history lookup", () => {
  const billing = read("../src/lib/billing.ts");
  const baseStart = billing.indexOf("export const getUserEntitlementState");
  const definitiveStart = billing.indexOf("export const getSubscriptionTrialEligibility");
  const baseEntitlement = billing.slice(baseStart, definitiveStart);

  assert.ok(baseStart > 0 && definitiveStart > baseStart);
  assert.ok(!baseEntitlement.includes("hasStripeSubscriptionHistory("));
  assert.match(
    billing.slice(definitiveStart),
    /getSubscriptionTrialEligibility[\s\S]*hasStripeSubscriptionHistory\(/,
  );
});

test("dynamic app routes are fully prefetched into Next's client router cache", () => {
  const safePrefetch = read("../src/lib/safe-router-prefetch.ts");
  const appShell = read("../src/components/app-shell.tsx");
  const instantLink = read("../src/components/instant-link.tsx");
  const dashboard = read("../src/components/home-dashboard.tsx");
  const nextConfig = read("../next.config.ts");

  assert.match(safePrefetch, /kind: options\.full \? "full" : "auto"/);
  assert.match(nextConfig, /staleTimes:\s*\{\s*dynamic: 60/);
  assert.match(
    appShell,
    /if \(!isCurrentRoute\) \{[\s\S]*?safeRouterPrefetch\(router, item\.href, \{ full: true \}\)/,
  );
  assert.doesNotMatch(appShell, /onInvalidate:[\s\S]*?warmRoute/);
  assert.match(instantLink, /safeRouterPrefetch\(router, href, \{ full: true \}\)/);
  assert.match(dashboard, /lecture\.status === "ready"[\s\S]*?\.slice\(0, 2\)/);
  assert.match(
    dashboard,
    /safeRouterPrefetch\(router, `\/app\/lectures\/\$\{lecture\.id\}`, \{ full: true \}\)/,
  );
});
