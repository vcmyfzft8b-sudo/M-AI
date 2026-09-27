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
import { isTransientAuthError } from "@/lib/supabase/auth-user";
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
    return refreshApiSession(request, requestHeaders, env);
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
    error,
  } = await supabase.auth.getUser();

  if (refusedRefresh(cookiesToSet, error)) {
    cookiesToSet = [];
  }

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

type SessionCookie = { name: string; value: string; options: CookieOptions };

/*
 * supabase-js answers any refresh it cannot use, a rate limit included, by dropping the session,
 * which reaches `setAll` as a write that only removes cookies. When Auth merely refused for a
 * moment (429, 5xx, a reset connection), passing that on would sign the learner out; the cookie
 * is left as it was and the next request tries again.
 */
function refusedRefresh(cookies: SessionCookie[], error: unknown) {
  return cookies.length > 0 && cookies.every(({ value }) => !value) && isTransientAuthError(error);
}

/*
 * These set a session themselves (native sign-in, impersonation, account deletion). A refreshed
 * copy of the old session sent from here would compete with theirs in the same response.
 */
const SESSION_WRITING_API_ROUTES = ["/api/mobile/", "/api/admin/impersonate", "/api/account/delete"];

const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

/**
 * An API request whose access token has expired gets it refreshed here, once, and the new
 * session goes both to the handler and back to the browser.
 *
 * Handlers verify the learner themselves, and nothing they refresh is ever written back (their
 * clients' `setAll` is a no-op). So a browser that only talks to the API, like a tutor
 * walkthrough, kept presenting the expired token, and every request refreshed it again, twice
 * when a route built a second client. On 2026-09-27 one walkthrough ran Auth into its rate limit
 * and the refused refreshes read the learner's own note as "Ni najdeno.".
 *
 * `getSession` only calls Auth when the stored token has expired, so a live session costs a
 * cookie parse. Only a session that was actually renewed is written; a refused refresh changes
 * nothing, and the handler answers it as it always has.
 */
async function refreshApiSession(
  request: NextRequest,
  requestHeaders: Headers,
  env: { supabaseUrl: string; supabaseAnonKey: string },
) {
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  const path = request.nextUrl.pathname;

  if (
    SESSION_WRITING_API_ROUTES.some((prefix) => path.startsWith(prefix)) ||
    !request.cookies.getAll().some(({ name }) => SESSION_COOKIE.test(name))
  ) {
    return next();
  }

  let renewed: SessionCookie[] = [];

  try {
    const supabase = createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(itemsToSet) {
          renewed = itemsToSet;
        },
      },
    });

    await supabase.auth.getSession();
  } catch {
    return next();
  }

  if (!renewed.some(({ value }) => value)) {
    return next();
  }

  renewed.forEach(({ name, value }) => {
    if (value) {
      request.cookies.set(name, value);
    } else {
      request.cookies.delete(name);
    }
  });
  requestHeaders.set("cookie", request.headers.get("cookie") ?? "");

  const response = next();

  renewed.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  return response;
}
