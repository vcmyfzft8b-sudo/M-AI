"use client";

import { createContext, useContext, useEffect, useMemo } from "react";

import type { MessageKey, Messages } from "@/lib/i18n/messages/keys";
import {
  LOCALE_BCP47,
  LOCALE_INTL_TAG,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
} from "@/lib/i18n/locales";
import { createTranslator, type Translate } from "@/lib/i18n/translate";

type I18nValue = {
  locale: Locale;
  t: Translate<MessageKey>;
};

/**
 * There is no sensible default translator — a `t` with no catalogue behind it
 * would render keys — so the context starts empty and `useTranslations` throws
 * rather than silently rendering `settings.title` at somebody.
 */
const I18nContext = createContext<I18nValue | null>(null);

function readLocaleCookie() {
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));

  return match ? decodeURIComponent(match[1]) : null;
}

export function writeLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}

/**
 * The whole catalogue is handed to the client rather than split by screen.
 *
 * Measured: 960 keys, 57 KB of JSON, 17 KB gzipped — and only the one language
 * being rendered is ever sent, because the server picks it. Against that, the
 * strings it replaces were already in the client bundles, spread across chunks.
 * Splitting it into namespaces would save a few kilobytes and buy back the
 * failure mode where a component reaches for a key its subtree was not given.
 */
export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({ locale, t: createTranslator<MessageKey>(locale, [messages]) }),
    [locale, messages],
  );

  /*
   * Keep the document in step with the language actually being rendered.
   *
   * Both of these matter for the one case the cookie is not already right: a
   * signed-in visitor on a second device, where the request-time cookie came
   * from geo-detection but the account has a saved preference. The shell
   * renders the account's language and this writes it back, so the next
   * request agrees with this one and `<html lang>` — which the server had to
   * guess before it knew — is corrected for screen readers and for the
   * browser's own translation prompt.
   */
  useEffect(() => {
    if (document.documentElement.lang !== locale) {
      document.documentElement.lang = locale;
    }

    if (readLocaleCookie() !== locale) {
      writeLocaleCookie(locale);
    }
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslations() {
  const value = useContext(I18nContext);

  if (!value) {
    throw new Error("useTranslations must be used inside <I18nProvider>.");
  }

  return value;
}

/** Just `t`, for the common case where the locale itself is not needed. */
export function useT() {
  return useTranslations().t;
}

/** The tag to hand `Intl` in a client component. */
export function useLocaleTag() {
  return LOCALE_INTL_TAG[useTranslations().locale];
}
