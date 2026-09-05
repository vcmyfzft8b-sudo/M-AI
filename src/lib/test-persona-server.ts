import "server-only";

import { cookies } from "next/headers";

import { getOptionalUser } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/super-admin";
import {
  isRealPersona,
  parseTestPersona,
  REAL_TEST_PERSONA,
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
