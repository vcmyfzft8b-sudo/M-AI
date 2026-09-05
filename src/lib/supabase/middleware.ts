import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  localeForCountry,
  parseLocale,
  type Locale,
} from "@/lib/i18n/locales";
import { LOCALE_HEADER } from "@/lib/i18n/routing";
import { getPublicEnv } from "@/lib/public-env";
import {
  serializeVerifiedPageUser,
  VERIFIED_PAGE_USER_HEADER,
} from "@/lib/verified-page-user";

/** Vercel's country-of-IP header. Absent everywhere else, which is fine. */
const GEO_COUNTRY_HEADER = "x-vercel-ip-country";

/**
 * Give a visitor with no language cookie the one their URL or their country
 * implies, so that the choice is durable from the first request rather than
 * being re-derived on every one.
 *
 * The URL comes first. A `/sl` link forwarded to a friend in Zagreb is someone
 * saying which version to read, and without this the first unprefixed link
 * they then click would bounce them to `/hr` mid-visit.
 *
 * Only ever *adds* a cookie. Somebody who has picked a language — or whose
 * account preference was restored at sign-in — already has one, and neither
 * the URL nor geo may talk over that: a Croatian student on exchange in Vienna
 * keeps Croatian.
 */
function seedLocaleCookie(
  request: NextRequest,
  response: NextResponse,
  routeLocale: Locale | null,
) {
  if (parseLocale(request.cookies.get(LOCALE_COOKIE)?.value)) {
    return response;
  }

  const detected =
    routeLocale ?? localeForCountry(request.headers.get(GEO_COUNTRY_HEADER)) ?? DEFAULT_LOCALE;

  response.cookies.set(LOCALE_COOKIE, detected, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });

  return response;
}

/**
 * Where the request is really going, once src/proxy.ts has taken any language
 * prefix off the front of it. `locale` is the language the URL named, or
 * `null` when it named none and the cookie decides.
 */
export type LocaleRoute = { locale: Locale | null; pathname: string };

export async function updateSession(request: NextRequest, route?: LocaleRoute) {
  const env = getPublicEnv();
  const pathname = route?.pathname ?? request.nextUrl.pathname;
  const requestHeaders = new Headers(request.headers);
  // The path the app should think it is on: `/sl/legal/x` is `/legal/x` in
  // Slovenian, and the nav highlighting that reads this must not see the
  // prefix.
  requestHeaders.set("x-pathname", pathname);
  // Never let the browser supply the private authentication handoff. Page
  // requests get a fresh value below only after Supabase validates the cookie;
  // API routes deliberately get none and authenticate inside their handler.
  requestHeaders.delete(VERIFIED_PAGE_USER_HEADER);
  // Same reasoning: the language of the URL is decided here, not by whatever a
  // client chose to send.
  requestHeaders.delete(LOCALE_HEADER);

  if (route?.locale) {
    requestHeaders.set(LOCALE_HEADER, route.locale);
  }

  /**
   * `/sl` renders `/`. Rewriting rather than duplicating the route tree is the
   * whole reason there is no `[locale]` segment: one set of page files, five
   * addresses, and the language arrives as a header.
   */
  const rewriteTo =
    route && route.pathname !== request.nextUrl.pathname
      ? (() => {
          const url = request.nextUrl.clone();
          url.pathname = route.pathname;
          return url;
        })()
      : null;

  const proceed = (init: { request: { headers: Headers } }) =>
    rewriteTo ? NextResponse.rewrite(rewriteTo, init) : NextResponse.next(init);

  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return seedLocaleCookie(
      request,
      proceed({
        request: {
          headers: requestHeaders,
        },
      }),
      route?.locale ?? null,
    );
  }

  if (pathname.startsWith("/api/")) {
    return proceed({
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

  if (user) {
    requestHeaders.set(VERIFIED_PAGE_USER_HEADER, serializeVerifiedPageUser(user));
  }

  const response = proceed({
    request: {
      headers: requestHeaders,
    },
  });

  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  // Last, deliberately: locale and refreshed session cookies must share the
  // same final response.
  return seedLocaleCookie(request, response, route?.locale ?? null);
}
