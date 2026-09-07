import "server-only";

import { cookies } from "next/headers";

import { getOptionalUser } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/super-admin";
import {
  isRealPersona,
  parseTestPersona,
  REAL_TEST_PERSONA,
  serializeTestPersona,
  TEST_PERSONA_COOKIE,
  type TestPersona,
} from "@/lib/test-persona";

/**
 * The persona in force for this request, or null.
 *
 * The cookie is unsigned on purpose: it is not what grants anything. The check
 * that matters is the one below it — the request must carry a confirmed session
 * for the super-admin address — so a cookie set by anyone else is read, found
 * to belong to nobody, and dropped. Making it a bearer token would add a secret
 * to leak without adding a permission it does not already have.
 */
export async function readActiveTestPersona(): Promise<TestPersona | null> {
  let user;

  try {
    user = await getOptionalUser();
  } catch {
    // Outside a request — a background job, a webhook. Nothing to read.
    return null;
  }

  if (!isSuperAdmin(user)) {
    return null;
  }

  const store = await cookies();
  const persona = parseTestPersona(store.get(TEST_PERSONA_COOKIE)?.value);

  return isRealPersona(persona) ? null : persona;
}

/** The persona in force for `userId`, which must be the signed-in account's own. */
export async function readTestPersonaFor(userId: string): Promise<TestPersona | null> {
  let user;

  try {
    user = await getOptionalUser();
  } catch {
    return null;
  }

  // Only ever your own view of your own account. A persona must not be able to
  // change what the app believes about anybody else.
  if (!user || user.id !== userId) {
    return null;
  }

  return readActiveTestPersona();
}

/**
 * The persona to draw the panel with: the one in force, or "real" when none is.
 *
 * `readActiveTestPersona` answers null for both "nobody" and "nothing set",
 * which is what the entitlement path wants and what the panel does not — it has
 * to show the controls either way.
 */
export async function readTestPersonaOrReal(): Promise<TestPersona> {
  return (await readActiveTestPersona()) ?? REAL_TEST_PERSONA;
}

/**
 * Ends an onboarding persona that the account has just made untrue.
 *
 * A persona saying "not onboarded" is what puts you back into the survey, and
 * finishing the survey writes a real `onboarding_completed_at` — after which
 * the persona is still saying you have not finished, so the app sends you
 * straight back to the start of it. The loop has no exit inside the flow, and
 * the panel that would turn it off is behind the same redirect.
 *
 * So finishing it for real is what ends it. Testing the survey again is one tap
 * in Settings; being unable to leave it is not.
 */
export async function clearOnboardingTestPersona() {
  const persona = await readActiveTestPersona();

  if (!persona || persona.onboarding !== "pending") {
    return;
  }

  const next: TestPersona = { ...persona, onboarding: "real" };
  const store = await cookies();

  if (isRealPersona(next)) {
    store.delete(TEST_PERSONA_COOKIE);
    return;
  }

  store.set(TEST_PERSONA_COOKIE, serializeTestPersona(next), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}
