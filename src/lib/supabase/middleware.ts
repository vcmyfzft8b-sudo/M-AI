import { createServerClient } from "@supabase/ssr";
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
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

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

  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
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

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  await supabase.auth.getUser();

  // Last, deliberately: `setAll` above replaces `response` wholesale when the
  // session is refreshed, so a cookie written before that call would be
  // dropped on exactly the requests that refresh a session.
  return seedLocaleCookie(request, response);
}
