"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useSyncExternalStore } from "react";

import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale, parseLocale } from "@/lib/i18n/locales";

import "./globals.css";

/**
 * Replaces the root layout when it is the layout itself that failed, so this
 * file owns <html>/<body> and imports the stylesheet directly. It deliberately
 * avoids next/image and shared components — anything that could be part of the
 * failure — and uses plain anchors instead of next/link.
 *
 * That principle is why its four strings are written out here instead of coming
 * from the message catalogues. `I18nProvider` lives in the root layout, which
 * by definition did not render; reaching for `useTranslations` would throw
 * inside the screen whose whole job is to survive a throw. The locale itself is
 * read straight from the cookie, and the strings are copied from `sl.ts`,
 * `en.ts` and the rest — keep them in step by hand if that copy changes.
 */
const FALLBACK_COPY: Record<Locale, { title: string; copy: string; retry: string; home: string; digest: string }> = {
  sl: {
    title: "Nekaj je šlo narobe.",
    copy: "Napako smo zabeležili in jo pregledujemo. Poskusi znova ali se vrni čez nekaj minut.",
    retry: "Poskusi znova",
    home: "Nazaj na domačo stran",
    digest: "Koda napake:",
  },
  en: {
    title: "Something went wrong.",
    copy: "We have logged the error and are looking into it. Try again, or come back in a few minutes.",
    retry: "Try again",
    home: "Back to the home page",
    digest: "Error code:",
  },
  hr: {
    title: "Nešto je pošlo po zlu.",
    copy: "Zabilježili smo grešku i pregledavamo je. Pokušaj ponovno ili se vrati za nekoliko minuta.",
    retry: "Pokušaj ponovno",
    home: "Natrag na početnu stranicu",
    digest: "Kod greške:",
  },
  bs: {
    title: "Nešto je pošlo po zlu.",
    copy: "Zabilježili smo grešku i pregledavamo je. Pokušaj ponovo ili se vrati za nekoliko minuta.",
    retry: "Pokušaj ponovo",
    home: "Nazad na početnu stranicu",
    digest: "Kod greške:",
  },
  sr: {
    title: "Nešto je pošlo naopako.",
    copy: "Zabeležili smo grešku i pregledamo je. Pokušaj ponovo ili se vrati za nekoliko minuta.",
    retry: "Pokušaj ponovo",
    home: "Nazad na početnu stranicu",
    digest: "Kod greške:",
  },
};

function readLocaleCookie(): Locale {
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));

  return parseLocale(match ? decodeURIComponent(match[1]) : null) ?? DEFAULT_LOCALE;
}

/** The cookie cannot change while this screen is up, so there is nothing to watch. */
function subscribeToNothing() {
  return () => undefined;
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  /*
   * Read during render rather than in an effect, the way the settings screen
   * reads its platform: the server has no `document`, so the first pass must
   * say "the default" and the client must be free to disagree without a
   * hydration mismatch. A one-frame flash of English is the right trade here —
   * this screen has to render even when nothing else does.
   */
  const locale = useSyncExternalStore(
    subscribeToNothing,
    readLocaleCookie,
    () => DEFAULT_LOCALE,
  );
  const copy = FALLBACK_COPY[locale];

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang={locale}>
      <body>
        <main className="error-screen">
          <div className="error-screen-inner">
            <span className="error-screen-brand" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/memo-lockup.png" alt="Memo AI" width={480} height={148} />
            </span>

            <p className="error-screen-code">500</p>
            <h1 className="error-screen-title">{copy.title}</h1>
            <p className="error-screen-copy">{copy.copy}</p>

            <div className="error-screen-actions">
              <button type="button" className="error-screen-primary" onClick={reset}>
                {copy.retry}
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" className="error-screen-secondary">
                {copy.home}
              </a>
              {error.digest ? (
                <p className="error-screen-digest">
                  {copy.digest} {error.digest}
                </p>
              ) : null}
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
