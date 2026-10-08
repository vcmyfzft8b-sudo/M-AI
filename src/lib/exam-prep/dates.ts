/**
 * Calendar days for the exam journey.
 *
 * A study day is the learner's day, not the server's: a review at 00:30 in
 * Ljubljana belongs to that morning, not to the previous UTC evening. Every day
 * here is a `YYYY-MM-DD` key in the plan's time zone, and day arithmetic is done
 * on those keys through UTC midnight, which has no daylight-saving jumps.
 */

export type DayKey = string;

const DAY_MS = 86_400_000;
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatterCache.get(timeZone);

  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      // An unknown zone (an old browser, a hand-edited row) falls back to UTC
      // rather than failing the whole journey.
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }

    formatterCache.set(timeZone, formatter);
  }

  return formatter;
}

export function isDayKey(value: unknown): value is DayKey {
  if (typeof value !== "string" || !DAY_KEY_PATTERN.test(value)) {
    return false;
  }

  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The day `ms` falls on in `timeZone`. */
export function dayKeyAt(ms: number, timeZone: string): DayKey {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function toUtcMs(day: DayKey) {
  return Date.parse(`${day}T00:00:00Z`);
}

export function addDays(day: DayKey, days: number): DayKey {
  return new Date(toUtcMs(day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: DayKey, to: DayKey) {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** Monday = 0 … Sunday = 6, matching the `rest_days` bitmask. */
export function weekdayIndex(day: DayKey) {
  return (new Date(toUtcMs(day)).getUTCDay() + 6) % 7;
}

export function isRestDay(day: DayKey, restDays: number) {
  return (restDays & (1 << weekdayIndex(day))) !== 0;
}

/** The first day of the month `day` is in. */
export function monthOf(day: DayKey): DayKey {
  return `${day.slice(0, 7)}-01`;
}

/** The first day of the month `months` after (or before) `month`'s. */
export function addMonths(month: DayKey, months: number): DayKey {
  const date = new Date(toUtcMs(monthOf(month)));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

/**
 * A month as a Monday-first calendar: six weeks of seven cells, the days of
 * the month in place and `null` around them. Always six rows, so the calendar
 * keeps its height when the learner pages between months.
 */
export function monthGrid(month: DayKey): (DayKey | null)[] {
  const first = monthOf(month);
  const length = diffDays(first, addMonths(first, 1));
  const lead = weekdayIndex(first);
  return Array.from({ length: 42 }, (_, cell) =>
    cell < lead || cell >= lead + length ? null : addDays(first, cell - lead),
  );
}

/**
 * Days elapsed between two instants, for the memory model. Fractional on
 * purpose: forgetting does not wait for midnight.
 */
export function elapsedDays(fromMs: number, toMs: number) {
  return Math.max(0, (toMs - fromMs) / DAY_MS);
}

/** Midday of a day key, used as the instant a simulated review happens. */
export function middayMs(day: DayKey) {
  return toUtcMs(day) + DAY_MS / 2;
}

/** The morning of the exam: the moment memory has to hold until. */
export function examMorningMs(day: DayKey) {
  return toUtcMs(day) + DAY_MS * 0.375;
}
