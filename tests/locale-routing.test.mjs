import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { LOCALES } from "../src/lib/i18n/locales.ts";
import {
  absoluteLocalizedUrl,
  HREFLANG,
  isLocalizedPath,
  localeAlternates,
  localizedPath,
  stripLocalePrefix,
} from "../src/lib/i18n/routing.ts";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("English lives at the root and every other language under a prefix", () => {
  assert.equal(localizedPath("/", "en"), "/");
  assert.equal(localizedPath("/legal/terms-of-use", "en"), "/legal/terms-of-use");

  assert.equal(localizedPath("/", "sl"), "/sl");
  assert.equal(localizedPath("/legal/terms-of-use", "sl"), "/sl/legal/terms-of-use");
  assert.equal(localizedPath("/legal/refund-policy", "sr"), "/sr/legal/refund-policy");
});

test("a language prefix comes off the front of a path, leaving a rooted path", () => {
  // `/sl` is the landing page, so what is left has to be "/" and not "".
  assert.deepEqual(stripLocalePrefix("/sl"), { locale: "sl", pathname: "/" });
  assert.deepEqual(stripLocalePrefix("/hr/legal/privacy-policy"), {
    locale: "hr",
    pathname: "/legal/privacy-policy",
  });
});

test("only a whole segment naming a language we ship is a prefix", () => {
  // `/slides` starts with "sl" and is not Slovenian; `/de` is a two-letter
  // segment for a language Memo does not ship. Both are ordinary paths.
  for (const pathname of ["/slides", "/de", "/de/legal/terms-of-use", "/app", "/"]) {
    assert.deepEqual(
      stripLocalePrefix(pathname),
      { locale: null, pathname },
      `${pathname} must not be read as a language prefix`,
    );
  }
});

test("stripping a prefix is the inverse of adding one", () => {
  for (const locale of LOCALES) {
    for (const pathname of ["/", "/legal/terms-of-use", "/legal/refund-policy"]) {
      const round = stripLocalePrefix(localizedPath(pathname, locale));

      assert.equal(round.pathname, pathname);
      // English adds no prefix, so there is nothing for the strip to find.
      assert.equal(round.locale, locale === "en" ? null : locale);
    }
  }
});

test("only the public pages have an address per language", () => {
  for (const pathname of ["/", "/legal/terms-of-use", "/legal/privacy-policy"]) {
    assert.equal(isLocalizedPath(pathname), true, pathname);
  }

  // Everything behind a login has one address. A per-language copy of it would
  // be five URLs a crawler is told not to fetch anyway.
  for (const pathname of ["/app", "/app/settings", "/auth/login", "/admin", "/creator"]) {
    assert.equal(isLocalizedPath(pathname), false, pathname);
  }

  // "/legalese" is not under "/legal".
  assert.equal(isLocalizedPath("/legalese"), false);
});

test("every page names all five languages plus x-default", () => {
  const { canonical, languages } = localeAlternates("/legal/terms-of-use", "hr");

  assert.equal(canonical, "/hr/legal/terms-of-use");
  assert.deepEqual(languages, {
    "sl-SI": "/sl/legal/terms-of-use",
    "en-GB": "/legal/terms-of-use",
    "hr-HR": "/hr/legal/terms-of-use",
    "bs-BA": "/bs/legal/terms-of-use",
    "sr-Latn-RS": "/sr/legal/terms-of-use",
    // The version for a reader none of the four markets fits, which is the
    // English page at the root.
    "x-default": "/legal/terms-of-use",
  });
});

test("each language's canonical is its own hreflang entry", () => {
  for (const locale of LOCALES) {
    const { canonical, languages } = localeAlternates("/", locale);

    assert.equal(
      languages[HREFLANG[locale]],
      canonical,
      `${locale} must point its own hreflang at its canonical`,
    );
  }
});

test("sitemap URLs are written the way the canonical tag writes them", () => {
  // Next renders a canonical of "/" against metadataBase as the bare origin,
  // so the sitemap must not add a slash the pages never claim.
  assert.equal(absoluteLocalizedUrl("https://memoai.eu", "/", "en"), "https://memoai.eu");
  assert.equal(absoluteLocalizedUrl("https://memoai.eu", "/", "sl"), "https://memoai.eu/sl");
  assert.equal(
    absoluteLocalizedUrl("https://memoai.eu", "/legal/refund-policy", "bs"),
    "https://memoai.eu/bs/legal/refund-policy",
  );
});

test("the URL outranks the cookie when deciding a page's language", () => {
  const server = read("../src/lib/i18n/server.ts");
  const headerIndex = server.indexOf("headerStore.get(LOCALE_HEADER)");
  const cookieIndex = server.indexOf("cookieStore.get(LOCALE_COOKIE)");

  assert.ok(headerIndex > 0, "getLocale must read the language the URL named");
  assert.ok(
    headerIndex < cookieIndex,
    "an indexed /sl page must be Slovenian for a reader whose cookie says otherwise",
  );
});

test("the language header cannot be supplied by the browser", () => {
  const middleware = read("../src/lib/supabase/middleware.ts");
  const deleteIndex = middleware.indexOf("requestHeaders.delete(LOCALE_HEADER)");
  const setIndex = middleware.indexOf("requestHeaders.set(LOCALE_HEADER");

  assert.ok(deleteIndex > 0, "an incoming x-memo-locale must be removed");
  assert.ok(
    deleteIndex < setIndex,
    "the header must be cleared before the proxy writes the language it resolved",
  );
});

test("the picker leaves a localized page by loading the new address", () => {
  const picker = read("../src/components/language-picker.tsx");

  // A soft navigation reuses the client router entry the rewrite left under
  // the unprefixed URL, so the address and the cookie change and the page does
  // not. See the comment at the call.
  assert.match(picker, /window\.location\.assign\(target\)/);
  assert.doesNotMatch(picker, /router\.(replace|push)\(target\)/);
});

test("robots keeps the signed-in surfaces out, and noindex backs it up", () => {
  const robots = read("../src/app/robots.ts");

  for (const path of ["/api/", "/app/", "/auth/", "/creator", "/admin"]) {
    assert.ok(robots.includes(`"${path}"`), `${path} must be disallowed`);
  }

  // Disallow stops the crawl, not the indexing of a URL somebody links to.
  for (const layout of ["../src/app/app/layout.tsx", "../src/app/auth/layout.tsx"]) {
    assert.match(read(layout), /robots:\s*\{\s*index:\s*false/, layout);
  }
});
