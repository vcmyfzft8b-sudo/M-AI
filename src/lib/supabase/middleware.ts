import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";
import {
  CZECH_LOCALE,
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  getLocaleFromPathname,
  normalizeLocale,
  shouldPreferCzech,
} from "@/lib/i18n";
import { getPublicEnv } from "@/lib/public-env";

export async function updateSession(request: NextRequest) {
  const env = getPublicEnv();
  const pathLocale =
    request.nextUrl.pathname === "/"
      ? DEFAULT_LOCALE
      : getLocaleFromPathname(request.nextUrl.pathname);
  const cookieLocale = request.cookies.get(LOCALE_COOKIE_NAME)?.value;
  const detectedLocale = pathLocale ?? normalizeLocale(cookieLocale);
  const shouldRedirectToCzech =
    request.nextUrl.pathname === "/" &&
    !cookieLocale &&
    shouldPreferCzech({
      acceptLanguage: request.headers.get("accept-language"),
      country: request.headers.get("x-vercel-ip-country"),
    });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  requestHeaders.set("x-memo-locale", shouldRedirectToCzech ? CZECH_LOCALE : detectedLocale);

  if (shouldRedirectToCzech) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/cz";
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set(LOCALE_COOKIE_NAME, CZECH_LOCALE, {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
    });
    return response;
  }

  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
    response.cookies.set(LOCALE_COOKIE_NAME, detectedLocale, {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
    });
    return response;
  }

  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.cookies.set(LOCALE_COOKIE_NAME, pathLocale ?? detectedLocale ?? DEFAULT_LOCALE, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return response;
  }

  const supabase = createServerClient<Database>(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request: {
              headers: requestHeaders,
            },
          });
          response.cookies.set(LOCALE_COOKIE_NAME, pathLocale ?? detectedLocale ?? DEFAULT_LOCALE, {
            maxAge: 60 * 60 * 24 * 365,
            path: "/",
            sameSite: "lax",
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  await supabase.auth.getUser();

  return response;
}
