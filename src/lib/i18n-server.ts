import "server-only";

import { cookies, headers } from "next/headers";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  type AppLocale,
  getDictionary,
  normalizeLocale,
} from "@/lib/i18n";

export async function getRequestLocale(): Promise<AppLocale> {
  const requestHeaders = await headers();
  const headerLocale = requestHeaders.get("x-memo-locale");

  if (headerLocale) {
    return normalizeLocale(headerLocale);
  }

  const cookieStore = await cookies();
  return normalizeLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? DEFAULT_LOCALE);
}

export async function getRequestDictionary() {
  return getDictionary(await getRequestLocale());
}
