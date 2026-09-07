import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isSuperAdmin } from "../src/lib/super-admin.ts";
import {
  applyTestPersona,
  parseTestPersona,
  serializeTestPersona,
  TEST_PERSONA_BILLING,
  TEST_PERSONA_ONBOARDING,
} from "../src/lib/test-persona.ts";

/**
 * The panel that lets an account tell the app it has a subscription it has not
 * bought. Everything about who may do that is one predicate and one endpoint,
 * so both are pinned here.
 */

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

function filesBelow(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);

    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

const confirmed = (email) => ({ email, email_confirmed_at: "2026-01-01T00:00:00Z" });

test("only the named address, and only once confirmed", () => {
  assert.equal(isSuperAdmin(confirmed("nace.valencic@gmail.com")), true);
  // Addresses are compared case-insensitively and trimmed, as everywhere else.
  assert.equal(isSuperAdmin(confirmed("  Nace.Valencic@Gmail.com  ")), true);

  assert.equal(isSuperAdmin(null), false, "no session");
  assert.equal(isSuperAdmin(undefined), false, "no session");
  assert.equal(isSuperAdmin({ email: null }), false, "no address");
  assert.equal(isSuperAdmin(confirmed("someone.else@gmail.com")), false, "another account");
  assert.equal(
    isSuperAdmin(confirmed("nace.valencic@gmail.com.attacker.test")),
    false,
    "a lookalike domain",
  );
  assert.equal(
    isSuperAdmin({ email: "nace.valencic@gmail.com" }),
    false,
    "an unconfirmed address claiming it",
  );

  // The preview bypass fabricates a session; it must never talk its way in.
  const bypass = readSource("src/lib/auth.ts");
  const bypassEmail = bypass.match(/email: "([^"]+)",\n\s+app_metadata/)[1];
  assert.equal(isSuperAdmin({ email: bypassEmail }), false);
  assert.equal(isSuperAdmin(confirmed(bypassEmail)), false);
});

test("the endpoint checks the same thing and says nothing to anybody else", () => {
  const route = readSource("src/app/api/test-persona/route.ts");
  const handler = route.slice(route.indexOf("export async function POST"));

  assert.match(handler, /if \(!isSuperAdmin\(user\)\)/);
  // Refused before the body is even parsed, and refused as "not found": there
  // is nothing to learn from discovering that this exists.
  assert.ok(
    handler.indexOf("isSuperAdmin") < handler.indexOf("parseJsonRequest"),
    "the gate must come before the body is read",
  );
  assert.match(handler, /status: 404/);
});

test("a persona is only ever the signed-in account's own", () => {
  const server = readSource("src/lib/test-persona-server.ts");

  assert.match(server, /user\.id !== userId/);
  assert.match(server, /isSuperAdmin\(user\)/);
});

test("entitlement resolves the persona for every reader, not just the paywall", () => {
  const billing = readSource("src/lib/billing.ts");
  const entitlement = billing.slice(
    billing.indexOf("export const getUserEntitlementState"),
    billing.indexOf("export const getSubscriptionTrialEligibility"),
  );

  assert.match(entitlement, /readTestPersonaFor\(userId\)/);
  assert.match(entitlement, /applyTestPersona\(state, persona, userId\)/);
});

test("nothing is written for a persona", () => {
  for (const source of [
    readSource("src/lib/test-persona.ts"),
    readSource("src/lib/test-persona-server.ts"),
    readSource("src/app/api/test-persona/route.ts"),
  ]) {
    assert.doesNotMatch(source, /\.upsert\(|\.insert\(|\.update\(|\.delete\(\s*\)/);
    assert.doesNotMatch(source, /createSupabaseServiceRoleClient|getStripeClient|stripe\./);
  }
});

test("the address never reaches a browser bundle", () => {
  const importers = filesBelow(fileURLToPath(new URL("../src", import.meta.url)))
    .filter((path) => /\.tsx?$/.test(path))
    .filter((path) => /from "@\/lib\/super-admin"/.test(readFileSync(path, "utf8")));

  assert.ok(importers.length > 0, "expected the gate to be used somewhere");

  for (const path of importers) {
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      /^"use client";/,
      `${path} is a client component and would ship the address`,
    );
  }
});

test("every persona describes a state a real account could be in", () => {
  const base = {
    profile: null,
    subscriptions: [],
    subscription: null,
    hasPaidAccess: false,
    onboardingComplete: true,
    trialLectureId: null,
    hasConsumedTrial: false,
    hasTrialLectureAvailable: true,
    canResumeTrialLecture: false,
    trialChatMessagesUsed: 0,
    trialChatMessagesRemaining: 5,
    subscriptionTrialEligible: true,
    canCreateNotes: true,
    canAccessPaywalledCreation: false,
    shouldShowTrialEntry: true,
  };

  for (const billing of TEST_PERSONA_BILLING) {
    for (const onboarding of TEST_PERSONA_ONBOARDING) {
      const state = applyTestPersona(base, { billing, onboarding }, "user-1");

      // Paid access and being sold a subscription are opposites, always.
      if (state.hasPaidAccess) {
        assert.equal(state.shouldShowTrialEntry, false, `${billing}: still offered a trial`);
        assert.equal(state.canAccessPaywalledCreation, false, `${billing}: still paywalled`);
        assert.ok(state.subscription, `${billing}: paid with no subscription to show`);
      }

      // Creating a note is exactly "paid, or a free note still to spend".
      assert.equal(
        state.canCreateNotes,
        state.hasPaidAccess || state.hasTrialLectureAvailable,
        `${billing}: canCreateNotes disagrees with what it is made of`,
      );
      assert.equal(
        state.canAccessPaywalledCreation,
        !state.canCreateNotes,
        `${billing}: paywalled disagrees with canCreateNotes`,
      );

      if (onboarding !== "real") {
        assert.equal(state.onboardingComplete, onboarding === "done");
      }
    }
  }

  // "real" changes nothing at all.
  assert.deepEqual(applyTestPersona(base, { billing: "real", onboarding: "real" }, "u"), base);
});

test("an unreadable cookie is no persona rather than a broken one", () => {
  assert.deepEqual(parseTestPersona(null), { billing: "real", onboarding: "real" });
  assert.deepEqual(parseTestPersona(""), { billing: "real", onboarding: "real" });
  assert.deepEqual(parseTestPersona("paid"), { billing: "paid", onboarding: "real" });
  assert.deepEqual(parseTestPersona("nonsense:rubbish"), {
    billing: "real",
    onboarding: "real",
  });
  assert.deepEqual(parseTestPersona("__proto__:done"), {
    billing: "real",
    onboarding: "done",
  });

  for (const billing of TEST_PERSONA_BILLING) {
    for (const onboarding of TEST_PERSONA_ONBOARDING) {
      const persona = { billing, onboarding };
      assert.deepEqual(parseTestPersona(serializeTestPersona(persona)), persona);
    }
  }
});

/**
 * A persona must not be a door that locks behind you.
 *
 * "Not onboarded" is a state the panel can put this account into, and the app
 * answers it by sending every route to the survey — including Settings, which
 * is where the switch that turns it off lives. Completing the survey does not
 * help on its own either: it writes a real completion the persona then
 * contradicts, so the flow ends by sending you back to the start of itself.
 * Both exits are asserted here because the way in is one tap.
 */
test("finishing the survey ends a persona that says it is unfinished", () => {
  const route = readSource("src/app/api/profile/onboarding/route.ts");
  const handler = route.slice(route.indexOf("export async function POST"));

  assert.match(handler, /await clearOnboardingTestPersona\(\)/);
  // After the write, not before: a save that failed leaves the persona alone.
  assert.ok(
    handler.indexOf("clearOnboardingTestPersona") > handler.lastIndexOf("status: 500"),
    "the persona must only be cleared once the profile is actually saved",
  );

  const server = readSource("src/lib/test-persona-server.ts");
  const clear = server.slice(server.indexOf("export async function clearOnboardingTestPersona"));

  // Only the onboarding half, and only when it is the half that traps.
  assert.match(clear, /persona\.onboarding !== "pending"/);
  assert.match(clear, /onboarding: "real"/);
  assert.doesNotMatch(clear, /billing: "real"/);
});

test("settings stays reachable while a persona is in force", () => {
  const layout = readSource("src/app/app/layout.tsx");
  const guard = layout.slice(
    layout.indexOf("!appState.onboardingComplete"),
    layout.indexOf("hasPaidAccess"),
  );

  assert.match(guard, /pathname === "\/app\/settings" && \(await readActiveTestPersona\(\)\)/);
  // And nothing else changes: everyone without a persona still gets sent to the
  // survey, from every route including that one.
  assert.match(guard, /redirect\("\/app\/start"\)/);
});
