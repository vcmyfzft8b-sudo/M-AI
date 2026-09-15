import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, localeForCountry, parseLocale } from "./locales";
import { reconcileLocaleOnSignIn } from "./profile-locale";

/** Every sign-in method restores the same durable preference as the PWA. */
export async function applySignInLocale(request: NextRequest, response: NextResponse, userId: string) {
  const detected = parseLocale(request.cookies.get(LOCALE_COOKIE)?.value)
    ?? localeForCountry(request.headers.get("x-vercel-ip-country")) ?? DEFAULT_LOCALE;
  const locale = await reconcileLocaleOnSignIn(userId, detected);
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/", maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: "lax",
  });
  return response;
}
