import "server-only";

import { parseLocale, type Locale } from "@/lib/i18n/locales";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * The account-level copy of the language choice (`profiles.ui_language`,
 * migration 0039).
 *
 * Request-time resolution never reads this — see `getLocale` for why — so
 * everything here runs at the two moments the cookie and the column can
 * disagree: when the picker is used, and when a session starts on a device
 * that has no cookie yet.
 */

/**
 * True when a failure is the database not having migration 0039's column.
 *
 * The migration reaches production on merge, so between a deploy and that
 * merge — and on any preview pointed at a staging branch that is behind — the
 * column is simply absent. A language preference that cannot be saved is worth
 * degrading over: the cookie still carries the choice for this browser.
 */
function isMissingLocaleSchema(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    Boolean(error.message?.includes("ui_language"))
  );
}

export async function readProfileLocale(userId: string): Promise<Locale | null> {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("profiles")
    .select("ui_language")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingLocaleSchema(error)) {
      return null;
    }

    throw error;
  }

  return parseLocale((data as { ui_language?: string | null } | null)?.ui_language);
}

/**
 * Saves the choice against the account, so it survives this browser.
 *
 * Returns whether it was actually stored, which the caller uses only to decide
 * what to report — the cookie is written either way, so the language changes on
 * screen even when the column is missing.
 */
export async function writeProfileLocale(userId: string, locale: Locale): Promise<boolean> {
  const { error } = await createSupabaseServiceRoleClient()
    .from("profiles")
    .update({ ui_language: locale } as never)
    .eq("id", userId);

  if (error) {
    if (isMissingLocaleSchema(error)) {
      return false;
    }

    throw error;
  }

  return true;
}

/**
 * Records the language a brand-new account was already being served in, so
 * that their first sign-in on a second device does not silently re-detect.
 *
 * Only fills a null: somebody who has used the picker has said what they want,
 * and the language they happen to be reading right now must not overwrite it.
 */
export async function seedProfileLocaleIfUnset(userId: string, locale: Locale): Promise<void> {
  const { error } = await createSupabaseServiceRoleClient()
    .from("profiles")
    .update({ ui_language: locale } as never)
    .eq("id", userId)
    .is("ui_language", null);

  if (error && !isMissingLocaleSchema(error)) {
    throw error;
  }
}

/**
 * Reconciles the two copies of the preference at the moment a session starts,
 * and returns the language this browser should now be using.
 *
 * A sign-in is the only point where an account's saved language can reach a
 * browser that has never seen it, so it is where the two are made to agree:
 *
 *   - the account has a saved language → it wins, and the caller re-stamps the
 *     cookie with it. This is what makes the choice cross-device.
 *   - the account has none → whatever the browser was already being served,
 *     detected or picked, is written to the account. A new signup keeps the
 *     language they read the landing page in.
 *
 * Never throws: a language preference is not worth failing a sign-in over.
 */
export async function reconcileLocaleOnSignIn(
  userId: string,
  requestLocale: Locale,
): Promise<Locale> {
  try {
    const stored = await readProfileLocale(userId);

    if (stored) {
      return stored;
    }

    await seedProfileLocaleIfUnset(userId, requestLocale);
  } catch (error) {
    console.error("Failed to reconcile ui_language at sign-in", { userId, error });
  }

  return requestLocale;
}
