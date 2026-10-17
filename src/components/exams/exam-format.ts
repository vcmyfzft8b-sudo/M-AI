import type { Locale } from "@/lib/i18n/locales";
import { LOCALE_INTL_TAG } from "@/lib/i18n/locales";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: Locale, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}:${JSON.stringify(options)}`;
  let format = formatters.get(key);

  if (!format) {
    format = new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], { timeZone: "UTC", ...options });
    formatters.set(key, format);
  }

  return format;
}

function dayDate(day: string) {
  return new Date(`${day}T12:00:00Z`);
}

/** "pon, 26. okt" — an exam day as the screens print it. */
export function formatExamDay(day: string, locale: Locale) {
  return formatter(locale, { weekday: "short", day: "numeric", month: "short" }).format(dayDate(day));
}

/** "ponedeljek, 26. oktober" — the long form, for the countdown card. */
export function formatExamDayLong(day: string, locale: Locale) {
  return formatter(locale, { weekday: "long", day: "numeric", month: "long" }).format(dayDate(day));
}

/** Two-letter weekday for the date strip. */
export function formatWeekdayShort(day: string, locale: Locale) {
  return formatter(locale, { weekday: "short" }).format(dayDate(day));
}

export function formatMonth(day: string, locale: Locale) {
  return formatter(locale, { month: "long", year: "numeric" }).format(dayDate(day));
}
