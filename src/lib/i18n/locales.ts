/**
 * The five languages Memo ships in.
 *
 * `sl` is the source language: every string in `messages/sl.ts` is written
 * first and the other four catalogues are typed against it, so a key can never
 * go missing from a translation without the build failing.
 *
 * Serbian is Latin script (`sr-Latn`). Cyrillic is the official script in
 * Serbia, but a Latin catalogue is readable to every speaker in all three new
 * markets, which means a misfiring geo lookup degrades into "slightly foreign
 * wording" rather than "unreadable page".
 */
export const LOCALES = ["sl", "en", "hr", "bs", "sr"] as const;

export type Locale = (typeof LOCALES)[number];

/** What a visitor gets when nothing else identifies them. */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * The language the source strings are authored in, and the fallback of last
 * resort behind `DEFAULT_LOCALE`.
 */
export const SOURCE_LOCALE: Locale = "sl";

export const LOCALE_COOKIE = "memo-locale";

/** A year: the choice should outlive a semester, not a session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * How each language names itself, for the picker. A language list written in
 * the reader's own language is the one thing a picker must get right — someone
 * who has landed on the wrong locale cannot read a list localised into it.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  sl: "Slovenščina",
  en: "English",
  hr: "Hrvatski",
  bs: "Bosanski",
  sr: "Srpski",
};

/**
 * The BCP 47 tag each locale maps to, for `<html lang>` and Open Graph — what
 * the page *is* in. Serbian carries its script subtag so nothing downstream
 * assumes the Cyrillic default.
 *
 * Not for `Intl`: see `LOCALE_INTL_TAG`.
 */
export const LOCALE_BCP47: Record<Locale, string> = {
  sl: "sl-SI",
  en: "en-GB",
  hr: "hr-HR",
  bs: "bs-BA",
  sr: "sr-Latn-RS",
};

/**
 * The tag to format dates, times and numbers with.
 *
 * Identical to `LOCALE_BCP47` except for Bosnian. Chrome's ICU accepts `bs-BA`
 * and reports it as resolved, but ships no date or number patterns for it and
 * quietly falls back to the CLDR root: measured on 2026-08-31, `bs-BA` rendered
 * 12 August 2026 as "2026-08-12" and 25342 as "25,342" — an ISO date and an
 * English thousands separator, neither of which is Bosnian. Node's fuller ICU
 * formats it correctly, so the two disagreed and the date also arrived as a
 * hydration mismatch.
 *
 * `hr-BA` is the fix rather than a hand-rolled format: Bosnian and Croatian
 * write dates, times and numbers identically, the region stays Bosnian, and
 * every engine has Croatian data. Plural rules are unaffected — Chrome does
 * carry those for `bs` — but they go through the same tag so there is one
 * answer to "which tag does `Intl` get".
 */
export const LOCALE_INTL_TAG: Record<Locale, string> = {
  ...LOCALE_BCP47,
  bs: "hr-BA",
};

export const LOCALE_OG_TAG: Record<Locale, string> = {
  sl: "sl_SI",
  en: "en_GB",
  hr: "hr_HR",
  bs: "bs_BA",
  sr: "sr_RS",
};

/**
 * Country of the request's IP to the language shown.
 *
 * Deliberately only the four home markets. Everywhere else falls through to
 * English rather than guessing from a neighbouring language: a visitor in
 * Austria or Germany is far more likely to read English than Slovenian, and a
 * wrong guess here is worse than no guess, because it is the first thing they
 * see.
 */
export const COUNTRY_LOCALE: Record<string, Locale> = {
  SI: "sl",
  HR: "hr",
  BA: "bs",
  RS: "sr",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * A locale from an untrusted string — a cookie, a form field, a database
 * column — or `null` when it names nothing we ship.
 */
export function parseLocale(value: unknown): Locale | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return isLocale(normalized) ? normalized : null;
}

/**
 * The language for a request coming from `countryCode`, per the map above.
 *
 * The header arrives uppercase from Vercel, but is lowercased by some proxies,
 * so the lookup normalises rather than trusting the case.
 */
export function localeForCountry(countryCode: string | null | undefined): Locale | null {
  if (!countryCode) {
    return null;
  }

  return COUNTRY_LOCALE[countryCode.trim().toUpperCase()] ?? null;
}

/**
 * The language Stripe's own hosted checkout is shown in.
 *
 * Stripe's catalogue has Slovenian, Croatian and English but neither Bosnian
 * nor Serbian, so those two fall back to Croatian rather than to English:
 * a Bosnian or Serbian speaker reads Croatian without effort, and the
 * alternative is the payment page — the one screen where confusion costs a
 * sale — switching to a language they did not ask for.
 */
export const STRIPE_CHECKOUT_LOCALE: Record<Locale, "sl" | "en" | "hr"> = {
  sl: "sl",
  en: "en",
  hr: "hr",
  bs: "hr",
  sr: "hr",
};
