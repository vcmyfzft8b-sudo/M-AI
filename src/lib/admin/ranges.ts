/**
 * Reporting windows for the admin dashboard.
 *
 * Metrics are stored per calendar day (`captured_on`), so the ranges are built
 * from plain `YYYY-MM-DD` strings rather than timestamps. "Today" is resolved in
 * the reporting timezone, which keeps a late-evening view in Ljubljana from
 * rolling over to tomorrow just because UTC already has.
 */

export const REPORT_TIME_ZONE = "Europe/Ljubljana";

export const RANGE_PRESETS = ["today", "7d", "30d", "month", "all"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export type DateRange = {
  preset: RangePreset;
  /** Inclusive first day, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive last day, `YYYY-MM-DD`. */
  to: string;
  /** Every day in the range, inclusive, ascending. */
  days: string[];
  label: string;
  /** The equally long window immediately before this one, for trend arrows. */
  previous: { from: string; to: string } | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The current calendar date in the reporting timezone, as `YYYY-MM-DD`. */
export function todayInReportZone(now: Date = new Date()): string {
  // `en-CA` formats as YYYY-MM-DD, which is the format we store and compare on.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, amount: number): string {
  return formatDay(new Date(parseDay(day).getTime() + amount * DAY_MS));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS);
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const total = daysBetween(from, to);

  for (let index = 0; index <= total; index += 1) {
    days.push(addDays(from, index));
  }

  return days;
}

export function normalizeRangePreset(value: string | undefined | null): RangePreset {
  return RANGE_PRESETS.includes(value as RangePreset)
    ? (value as RangePreset)
    : "7d";
}

/** The earliest day the dashboard will chart when the preset is `all`. */
const ALL_TIME_FLOOR_DAYS = 365;

export function resolveRange(
  preset: RangePreset,
  options?: { now?: Date; earliestDay?: string | null },
): DateRange {
  const today = todayInReportZone(options?.now);

  let from = today;
  let label = "Today";

  switch (preset) {
    case "today":
      from = today;
      label = "Today";
      break;
    case "7d":
      from = addDays(today, -6);
      label = "Last 7 days";
      break;
    case "30d":
      from = addDays(today, -29);
      label = "Last 30 days";
      break;
    case "month":
      from = `${today.slice(0, 7)}-01`;
      label = "This month";
      break;
    case "all": {
      const floor = addDays(today, -ALL_TIME_FLOOR_DAYS);
      const earliest = options?.earliestDay;
      from = earliest && earliest > floor ? earliest : floor;
      label = "All time";
      break;
    }
  }

  const span = daysBetween(from, today);

  return {
    preset,
    from,
    to: today,
    days: eachDay(from, today),
    label,
    // An all-time window has no comparable window before it.
    previous:
      preset === "all"
        ? null
        : { from: addDays(from, -(span + 1)), to: addDays(from, -1) },
  };
}

/**
 * The UTC offset of the reporting timezone at a given instant, in ms.
 *
 * Derived from `Intl` rather than hard-coded, so it follows CET/CEST across the
 * daylight-saving switch instead of being an hour out for half the year.
 */
function reportZoneOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((accumulator, part) => {
      accumulator[part.type] = part.value;
      return accumulator;
    }, {});

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asIfUtc - instant.getTime();
}

/** The instant midnight in the reporting timezone, as an ISO string. */
export function dayStartIso(day: string): string {
  const utcMidnight = parseDay(day);
  const offset = reportZoneOffsetMs(utcMidnight);

  return new Date(utcMidnight.getTime() - offset).toISOString();
}

/**
 * Timestamp bounds for a day range, for querying `timestamptz` columns.
 *
 * The bounds are real midnights in Europe/Ljubljana, not UTC midnights: the SQL
 * aggregates bucket by that zone, and using UTC here would put a query window
 * an hour or two out of step with the days it is meant to cover.
 */
export function rangeToTimestamps(range: { from: string; to: string }) {
  return {
    fromIso: dayStartIso(range.from),
    // Exclusive upper bound: the start of the day after `to`.
    toIso: dayStartIso(addDays(range.to, 1)),
  };
}

export function formatDayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(parseDay(day));
}

/**
 * How many whole months a set of days adds up to.
 *
 * A monthly retainer is owed per calendar month, so any window that is not a
 * whole month has to be pro-rated. Each day is counted as its own fraction
 * rather than dividing the total by an average month length, because a day in
 * February is worth 1/28 of a retainer and a day in March 1/31 -- and a window
 * spanning both would otherwise be wrong in a way nobody would spot.
 */
export function monthsCovered(days: string[]): number {
  const countedPerMonth = new Map<string, number>();

  for (const day of days) {
    const month = day.slice(0, 7);
    countedPerMonth.set(month, (countedPerMonth.get(month) ?? 0) + 1);
  }

  let total = 0;

  // Counted per month and divided once, rather than adding a day's fraction at
  // a time: summing 1/31 thirty-one times lands on 0.9999999999999993, and a
  // whole month has to come out as exactly one whole retainer.
  for (const [month, counted] of countedPerMonth) {
    const [year, monthNumber] = month.split("-").map(Number);
    // Day 0 of the next month is the last day of this one.
    const lengthOfMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

    total += counted / lengthOfMonth;
  }

  return total;
}

/** The current hour, 0-23, in the reporting timezone. */
export function hourInReportZone(now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now);

  return Number.parseInt(hour, 10);
}

/** `14:00`, for the hourly x axis on a single-day range. */
export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Percentage change, or `null` when there is no baseline to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }

  return ((current - previous) / previous) * 100;
}
