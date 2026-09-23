import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  localeForCountry,
  parseLocale,
} from "@/lib/i18n/locales";
import { getPublicEnv } from "@/lib/public-env";
import { accountDeletionRequested } from "@/lib/mobile/account-lifecycle";
import {
  serializeVerifiedPageUser,
  VERIFIED_PAGE_USER_HEADER,
} from "@/lib/verified-page-user";

/** Vercel's country-of-IP header. Absent everywhere else, which is fine. */
const GEO_COUNTRY_HEADER = "x-vercel-ip-country";

/**
 * Give a visitor with no language cookie the one their country implies, so
 * that the choice is durable from the first request rather than being
 * re-derived on every one.
 *
 * Only ever *adds* a cookie. Somebody who has picked a language — or whose
 * account preference was restored at sign-in — already has one, and geo must
 * not talk over that: a Croatian student on exchange in Vienna keeps Croatian.
 */
function seedLocaleCookie(request: NextRequest, response: NextResponse) {
  if (parseLocale(request.cookies.get(LOCALE_COOKIE)?.value)) {
    return response;
  }

  const detected = localeForCountry(request.headers.get(GEO_COUNTRY_HEADER)) ?? DEFAULT_LOCALE;

  response.cookies.set(LOCALE_COOKIE, detected, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });

  return response;
}

export async function updateSession(request: NextRequest) {
  const env = getPublicEnv();
  // The service worker fetches a public shell without cookies. Carry only its
  // validated language into this request; no session or account data is added.
  const offlineLocale = request.nextUrl.pathname === "/offline"
    ? parseLocale(request.nextUrl.searchParams.get("locale"))
    : null;
  if (offlineLocale) {
    request.cookies.set(LOCALE_COOKIE, offlineLocale);
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  // Never let the browser supply the private authentication handoff. Page
  // requests get a fresh value below only after Supabase validates the cookie;
  // API routes deliberately get none and authenticate inside their handler.
  requestHeaders.delete(VERIFIED_PAGE_USER_HEADER);

  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return seedLocaleCookie(
      request,
      NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      }),
    );
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  let cookiesToSet: Array<{
    name: string;
    value: string;
    options: CookieOptions;
  }> = [];

  const supabase = createServerClient<Database>(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(itemsToSet) {
          itemsToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          cookiesToSet = itemsToSet;
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && !accountDeletionRequested(user)) {
    requestHeaders.set(VERIFIED_PAGE_USER_HEADER, serializeVerifiedPageUser(user));
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  // Last, deliberately: locale and refreshed session cookies must share the
  // same final response.
  return seedLocaleCookie(request, response);
}
