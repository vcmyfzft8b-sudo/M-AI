import { LOCALE_INTL_TAG, type Locale } from "@/lib/i18n/locales";

/* User count for the landing hero.

   This is a maintained figure, not a live query. Registrations sit across
   several regional databases the web app does not read from, so a
   `select count(*)` here would undercount badly. The banner starts from the
   baseline below and ticks upward during each visit — per visitor, in their
   own browser, so it is not a shared counter that everyone watches move in
   lockstep. Nothing is written anywhere; the ticking is display only.

   Keep BASE honest: bump it when the real all-region total moves. */

export const USER_COUNT_BASE = 25_341;

/* Roughly how many sign-ups a minute the ticker implies. Increments land at
   random intervals averaging this rate, never on a fixed beat. */
export const USER_COUNT_PER_MINUTE = 15;

/* The noun after the number ("registriran uporabnik", "registrirana
   uporabnika", ...) used to be picked here by hand from `count % 100`, which
   is the Slovenian rule written out. It now lives in the message catalogues as
   the plural forms of `landing.registeredUsers`, because each language draws
   the line in a different place: Slovenian has a separate form for exactly
   two, Croatian, Bosnian and Serbian group two-to-four together, and English
   has one form and a plural. `Intl.PluralRules` picks between them. */

const userCountFormatters = new Map<Locale, Intl.NumberFormat>();

/** `25.341` in Slovenian and Croatian, `25,341` in English. */
export function formatUserCount(count: number, locale: Locale): string {
  const cached = userCountFormatters.get(locale);

  if (cached) {
    return cached.format(count);
  }

  const formatter = new Intl.NumberFormat(LOCALE_INTL_TAG[locale]);
  userCountFormatters.set(locale, formatter);

  return formatter.format(count);
}
