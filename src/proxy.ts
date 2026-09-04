import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  localeForCountry,
  parseLocale,
  type Locale,
} from "@/lib/i18n/locales";
import { isLocalizedPath, localizedPath, stripLocalePrefix } from "@/lib/i18n/routing";

/** Vercel's country-of-IP header. Absent everywhere else, which is fine. */
const GEO_COUNTRY_HEADER = "x-vercel-ip-country";

/**
 * One address per language, and exactly one.
 *
 * Three rules, in this order:
 *
 *   1. A prefix on a page that has one per language (`/sl`, `/hr/legal/...`)
 *      is stripped and handed to the renderer as a header. No route files are
 *      duplicated: `/sl` *is* `/`, rendered in Slovenian.
 *   2. A prefix anywhere else, and `/en` anywhere, is a duplicate of a page
 *      that already has a single address. It is redirected away permanently so
 *      neither a crawler nor a share link can mint a second URL for one page.
 *   3. A page that has one address per language, requested without a prefix by
 *      a reader whose language is not English, is redirected to theirs — 307,
 *      because which address is right depends on who is asking.
 *
 * Rule 3 is what makes rule 1 safe for crawlers: `/` answers in English to
 * anyone it cannot place, which is every crawl from outside the four markets,
 * so the English page and its `x-default` never disagree.
 */
function resolveLocaleRoute(request: NextRequest):
  | { kind: "redirect"; url: URL; status: 307 | 308 }
  | { kind: "render"; locale: Locale | null; pathname: string } {
  const { pathname } = request.nextUrl;
  const stripped = stripLocalePrefix(pathname);

  if (stripped.locale) {
    // `/en/...` is the root page wearing a prefix, and a prefix on anything
    // that is not localized names a page that has only one address.
    if (stripped.locale === DEFAULT_LOCALE || !isLocalizedPath(stripped.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = stripped.pathname;
      return { kind: "redirect", url, status: 308 };
    }

    return { kind: "render", locale: stripped.locale, pathname: stripped.pathname };
  }

  if (!isLocalizedPath(pathname)) {
    return { kind: "render", locale: null, pathname };
  }

  const reader =
    parseLocale(request.cookies.get(LOCALE_COOKIE)?.value) ??
    localeForCountry(request.headers.get(GEO_COUNTRY_HEADER)) ??
    DEFAULT_LOCALE;

  if (reader !== DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = localizedPath(pathname, reader);
    return { kind: "redirect", url, status: 307 };
  }

  return { kind: "render", locale: DEFAULT_LOCALE, pathname };
}

export async function proxy(request: NextRequest) {
  const route = resolveLocaleRoute(request);

  if (route.kind === "redirect") {
    const response = NextResponse.redirect(route.url, route.status);

    // The 307 above is chosen from the language cookie, so a shared cache must
    // not serve one reader's answer to another. The 308s do not depend on it,
    // but the header costs nothing and the alternative is explaining which of
    // these two responses is which to whatever sits in front of the app.
    response.headers.set("Vary", "Cookie");

    return response;
  }

  return updateSession(request, route);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
