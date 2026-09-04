// Imported by its real filename so the Node test runner can load this module directly; it
// cannot resolve the "@/" alias. See `allowImportingTsExtensions` in tsconfig.json.
import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from "./locales.ts";

/**
 * Where a language lives in the URL.
 *
 * Search engines index URLs, not cookies. Memo used to serve all five
 * languages from one address and pick between them with the `memo-locale`
 * cookie and the country header — which meant Googlebot, crawling from US
 * addresses with no cookie, only ever saw English. Four languages, including
 * the one the home market reads, were not in the index at all.
 *
 * So each language now has an address of its own. English keeps the bare root,
 * because it is the default and every link ever shared points at it; the other
 * four sit under a prefix.
 */
export const LOCALE_PATH_PREFIX: Record<Locale, string> = {
  en: "",
  sl: "/sl",
  hr: "/hr",
  bs: "/bs",
  sr: "/sr",
};

/**
 * The request header the proxy writes the URL's language into, read by
 * `getLocale()` ahead of the cookie.
 *
 * A header rather than a route param: the language has to reach the root
 * layout, `generateMetadata` and every server component under it, and only the
 * segment that owns `[locale]` would see a param. It is set exclusively by
 * src/proxy.ts, which strips it from the incoming request first — see the
 * delete in `updateSession`.
 */
export const LOCALE_HEADER = "x-memo-locale";

/**
 * The paths that exist in every language. Everything else — the app, auth, the
 * creator surface, admin — is one URL in whatever language the reader has
 * chosen, because it sits behind a login and is `Disallow`ed in robots.txt, so
 * a per-language copy would earn nothing and cost five times the URLs.
 *
 * `/legal` is a prefix match: the three public documents underneath it are the
 * only things it serves.
 */
const LOCALIZED_PATHS = ["/", "/legal"] as const;

export function isLocalizedPath(pathname: string): boolean {
  return LOCALIZED_PATHS.some(
    (path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)),
  );
}

/**
 * Split a language prefix off the front of a path.
 *
 * Returns the locale the URL named — `null` when it named none — and the path
 * with the prefix removed, always starting with a slash. `/sl` yields `/`, not
 * the empty string.
 */
export function stripLocalePrefix(pathname: string): {
  locale: Locale | null;
  pathname: string;
} {
  const match = /^\/([a-z]{2})(?=\/|$)/.exec(pathname);
  const candidate = match?.[1];

  if (!candidate || !isLocale(candidate)) {
    return { locale: null, pathname };
  }

  const rest = pathname.slice(match[0].length);

  return { locale: candidate, pathname: rest === "" ? "/" : rest };
}

/** The address `pathname` has in `locale`. Pass paths that already start with a slash. */
export function localizedPath(pathname: string, locale: Locale): string {
  const prefix = LOCALE_PATH_PREFIX[locale];

  if (!prefix) {
    return pathname;
  }

  return pathname === "/" ? prefix : `${prefix}${pathname}`;
}

/**
 * The absolute URL of a localized page, in exactly the form the page's own
 * canonical tag takes.
 *
 * The `/` in `localizedPath("/", "en")` has to go: Next resolves a canonical of
 * `"/"` against `metadataBase` as `https://memoai.eu`, and a sitemap that
 * listed `https://memoai.eu/` would be naming a URL that no page claims as its
 * canonical. Google reconciles the two, but there is no reason to make it.
 */
export function absoluteLocalizedUrl(origin: string, pathname: string, locale: Locale): string {
  const path = localizedPath(pathname, locale);

  return `${origin}${path === "/" ? "" : path}`;
}

/**
 * The `alternates` block for a page that exists in every language: one
 * canonical for the language being served, and an `hreflang` for each of the
 * five plus `x-default`.
 *
 * `x-default` is English at the root — the version for a reader none of the
 * four listed languages fits, which is exactly what the root already serves.
 *
 * Next resolves these against `metadataBase`, so relative paths are correct
 * here and become absolute in the HTML.
 */
export function localeAlternates(
  pathname: string,
  locale: Locale,
): { canonical: string; languages: Record<string, string> } {
  const languages: Record<string, string> = {};

  for (const other of LOCALES) {
    languages[HREFLANG[other]] = localizedPath(pathname, other);
  }

  languages["x-default"] = localizedPath(pathname, DEFAULT_LOCALE);

  return { canonical: localizedPath(pathname, locale), languages };
}

/**
 * The `hreflang` value for each language.
 *
 * Region-qualified, matching `LOCALE_BCP47` and `<html lang>`: these are four
 * neighbouring markets that read each other's languages, and an unqualified
 * `sr` would leave Google guessing which of them a page is for. Serbian keeps
 * its script subtag for the same reason it does everywhere else — the
 * catalogue is Latin, and the default assumption for `sr` is Cyrillic.
 */
const HREFLANG: Record<Locale, string> = {
  sl: "sl-SI",
  en: "en-GB",
  hr: "hr-HR",
  bs: "bs-BA",
  sr: "sr-Latn-RS",
};

export { HREFLANG };
