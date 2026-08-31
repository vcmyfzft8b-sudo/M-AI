import "server-only";

import { cookies, headers } from "next/headers";
import { cache } from "react";

import { getMessages } from "@/lib/i18n/messages";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  type Locale,
  localeForCountry,
  parseLocale,
} from "@/lib/i18n/locales";
import { createTranslator, type Translate } from "@/lib/i18n/translate";

/**
 * The header Vercel puts the requesting IP's country in. There is no fallback
 * for it: locally and on any other host it is simply absent, and detection
 * drops through to the default, which is what we want rather than a guess from
 * an unverified header a client could set itself.
 */
export const GEO_COUNTRY_HEADER = "x-vercel-ip-country";

/**
 * Which language this request is served in.
 *
 * The order is the whole policy:
 *
 *   1. The `memo-locale` cookie — an explicit choice, either made in the
 *      picker or restored from the account's saved preference at sign-in.
 *      Nothing overrides someone having said what they want.
 *   2. The country the IP resolves to, for the four home markets.
 *   3. English.
 *
 * Note what is *not* here: the account's `ui_language` column. Reading it
 * would put a database round trip in front of every page including the
 * landing page, which has no account to read. Instead the column is the
 * durable, cross-device copy and the cookie is the request-time one — the two
 * are reconciled at sign-in (`syncProfileLocaleCookie`) and whenever the
 * signed-in shell notices they disagree.
 */
export const getLocale = cache(async function getLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  const chosen = parseLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  if (chosen) {
    return chosen;
  }

  return localeForCountry(headerStore.get(GEO_COUNTRY_HEADER)) ?? DEFAULT_LOCALE;
});

/**
 * `t` for a server component, along with the locale it resolved to — callers
 * routinely need both, and asking for the locale separately would resolve it
 * twice.
 */
export const getTranslations = cache(async function getTranslations() {
  const locale = await getLocale();

  return { locale, t: getTranslationsFor(locale) };
});

/**
 * `t` for a locale that is already known — an API route that read the cookie
 * itself, a mail template, a background job rendering for a specific account.
 */
export function getTranslationsFor(locale: Locale): Translate<MessageKey> {
  return createTranslator<MessageKey>(locale, [
    getMessages(locale),
    getMessages(DEFAULT_LOCALE),
  ]);
}

/**
 * One message, in the language of the request being handled.
 *
 * The shorthand exists for API routes, where the alternative is threading a
 * translator through every handler in a file that has four of them. `getLocale`
 * is request-cached, so asking repeatedly costs a map lookup rather than a
 * cookie parse.
 *
 *     return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
 */
export async function tr(
  key: MessageKey,
  values?: Parameters<Translate<MessageKey>>[1],
): Promise<string> {
  const { t } = await getTranslations();

  return t(key, values);
}
