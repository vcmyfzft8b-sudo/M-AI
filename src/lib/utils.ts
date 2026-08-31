import { clsx, type ClassValue } from "clsx";

import { LOCALE_INTL_TAG, type Locale } from "@/lib/i18n/locales";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/*
 * Every market Memo ships in — Slovenia, Croatia, Bosnia and Herzegovina,
 * Serbia — is on Central European Time, so one zone covers all four and the
 * date a note was created reads the same on both sides of a border. English is
 * the odd one out, and deliberately: it is the fallback for "somewhere else",
 * which is not a timezone we can name. The app's own reporting is Ljubljana
 * time throughout (see src/lib/admin/ranges.ts), and a note stamped in a
 * different zone from the report that counts it would be worse than a note
 * stamped an hour off.
 */
const APP_TIME_ZONE = "Europe/Ljubljana";

/**
 * `Intl.DateTimeFormat` is expensive to construct and a library screen asks for
 * the same one on every row, so each locale's formatters are built once.
 */
const calendarDateFormatters = new Map<Locale, Intl.DateTimeFormat>();
const clockTimeFormatters = new Map<Locale, Intl.DateTimeFormat>();

function getFormatter(
  cache: Map<Locale, Intl.DateTimeFormat>,
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
) {
  const cached = cache.get(locale);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], {
    ...options,
    timeZone: APP_TIME_ZONE,
  });
  cache.set(locale, formatter);

  return formatter;
}

export function formatTimestamp(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((value) => value.toString().padStart(2, "0"))
      .join(":");
  }

  return [minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

/**
 * A calendar date in the reader's language: `31. 8. 2026` in Slovenian,
 * Croatian, Bosnian and Serbian, `31/08/2026` in English.
 *
 * This used to assemble the parts by hand around a hard-coded `sl-SI`, which
 * put a Slovenian date order in front of every reader. `Intl` already knows
 * each locale's order and separators, so it does the joining now — and it
 * produces exactly the same string as before for Slovenian.
 */
export function formatCalendarDate(isoString: string, locale: Locale) {
  return getFormatter(calendarDateFormatters, locale, {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(new Date(isoString));
}

/**
 * The time of day, 24-hour in every locale we ship — including English, where
 * the market is Europe rather than the US and the app's own recordings and
 * timestamps are 24-hour throughout.
 *
 * Callers join this to a date with the `date.dateAtTime` message, because the
 * word between them ("ob", "at", "u") is not something `Intl` will supply.
 */
export function formatClockTime(isoString: string, locale: Locale) {
  return getFormatter(clockTimeFormatters, locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(isoString));
}

export function stripCodeFences(value: string) {
  return value.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

export function serializeVector(values: number[]) {
  return `[${values.join(",")}]`;
}

export function safeJsonParse<T>(value: string): T {
  return JSON.parse(stripCodeFences(value)) as T;
}

export function notEmpty<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
