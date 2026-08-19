import "server-only";

import { unstable_cache } from "next/cache";

import { addDays, dayStartIso, eachDay, REPORT_TIME_ZONE } from "@/lib/admin/ranges";
import { DASHBOARD_REFRESH_SECONDS } from "@/lib/admin/refresh";

/**
 * Historical traffic from Vercel Web Analytics.
 *
 * Our own beacon (`/api/track`) only knows about traffic since it shipped, but
 * Vercel Web Analytics has been recording memoai.eu since March. It is the
 * source for anything historical — visits, page views, top paths, referrers and
 * countries — while the beacon stays responsible for "who is online right now",
 * which Vercel does not expose at all.
 *
 * These endpoints are the ones the Vercel dashboard itself calls. They are not
 * in the public API reference, so every response is parsed defensively and any
 * failure degrades to "no Vercel data" rather than breaking the page.
 */

const BASE_URL = "https://vercel.com/api/web-analytics/v2";

/** Cached because the dashboard hits it on several panels of the same page. */
const CACHE_SECONDS = DASHBOARD_REFRESH_SECONDS;

export type VercelTrafficDay = {
  day: string;
  /** Distinct devices, Vercel's closest equivalent to a visitor. */
  visitors: number;
  pageViews: number;
};

export type VercelBreakdownRow = { value: string; hits: number; visitors: number };

/**
 * One hourly bucket, kept alongside the daily fold.
 *
 * A single-day range folds down to one point, which draws as a lone dot. The
 * buckets Vercel returns are hourly to begin with, so they are carried through
 * unfolded and the day view charts those instead.
 */
export type VercelTrafficHour = {
  /** Calendar day in the reporting zone, `YYYY-MM-DD`. */
  day: string;
  /** Hour of that day in the reporting zone, 0-23. */
  hour: number;
  visitors: number;
  pageViews: number;
};

export type VercelTraffic = {
  series: VercelTrafficDay[];
  hours: VercelTrafficHour[];
  visitors: number;
  pageViews: number;
  paths: VercelBreakdownRow[];
  referrers: VercelBreakdownRow[];
  countries: VercelBreakdownRow[];
  browsers: VercelBreakdownRow[];
  operatingSystems: VercelBreakdownRow[];
};

type VercelConfig = { token: string; projectId: string; teamId?: string };

export function getVercelAnalyticsConfig(): VercelConfig | null {
  const token = process.env.VERCEL_ANALYTICS_TOKEN?.trim();
  // `VERCEL_PROJECT_ID` and `VERCEL_TEAM_ID` are injected automatically on
  // Vercel, so only the token normally has to be set by hand.
  const projectId =
    process.env.VERCEL_ANALYTICS_PROJECT_ID?.trim() ??
    process.env.VERCEL_PROJECT_ID?.trim();
  const teamId =
    process.env.VERCEL_ANALYTICS_TEAM_ID?.trim() ?? process.env.VERCEL_TEAM_ID?.trim();

  if (!token || !projectId) {
    return null;
  }

  return { token, projectId, teamId };
}

export function isVercelAnalyticsConfigured(): boolean {
  return getVercelAnalyticsConfig() !== null;
}

async function call(
  config: VercelConfig,
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${path}`);
  url.searchParams.set("projectId", config.projectId);
  url.searchParams.set("environment", "production");

  if (config.teamId) {
    url.searchParams.set("teamId", config.teamId);
  }

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Vercel analytics ${path} failed (${response.status}): ${(
        await response.text().catch(() => "")
      ).slice(0, 200)}`,
    );
  }

  return response.json();
}

function readRows(payload: unknown): VercelBreakdownRow[] {
  const data = (payload as { data?: unknown })?.data ?? payload;

  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((row) => {
      const entry = row as { key?: unknown; total?: unknown; devices?: unknown };

      return {
        value: typeof entry.key === "string" && entry.key ? entry.key : "unknown",
        hits: typeof entry.total === "number" ? entry.total : 0,
        visitors: typeof entry.devices === "number" ? entry.devices : 0,
      };
    })
    .sort((a, b) => b.visitors - a.visitors);
}

/** The calendar day an hourly bucket belongs to, in the reporting timezone. */
function bucketDay(key: string): string | null {
  const date = new Date(key);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** The hour of the day a bucket belongs to, in the reporting timezone. */
function bucketHour(key: string): number | null {
  const date = new Date(key);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);

  const parsed = Number.parseInt(hour, 10);

  return Number.isNaN(parsed) ? null : parsed;
}

async function fetchVercelTraffic(
  from: string,
  to: string,
): Promise<VercelTraffic> {
  const config = getVercelAnalyticsConfig();

  // Callers rule this out before reaching the cache. Throwing rather than
  // returning null keeps an unconfigured render out of the cached value, which
  // would otherwise outlive the misconfiguration by a full revalidate window.
  if (!config) {
    throw new Error("Vercel analytics is not configured");
  }

  const window = {
    from: dayStartIso(from),
    // Exclusive upper bound: the start of the day after `to`.
    to: dayStartIso(addDays(to, 1)),
  };

  const [timeseries, paths, referrers, countries, browsers, operatingSystems] =
    await Promise.all([
      call(config, "timeseries", window),
      call(config, "stats", { ...window, type: "path" }),
      call(config, "stats", { ...window, type: "referrer" }),
      call(config, "stats", { ...window, type: "country" }),
      call(config, "stats", { ...window, type: "client_name" }),
      call(config, "stats", { ...window, type: "os_name" }),
    ]);

  // Vercel returns hourly buckets, so they are folded into calendar days here.
  const byDay = new Map<string, VercelTrafficDay>();
  // Keyed `YYYY-MM-DDTH`. Left sparse: only hours Vercel actually reported land
  // here, and callers fill the gaps for the window they are drawing.
  const byHour = new Map<string, VercelTrafficHour>();

  for (const day of eachDay(from, to)) {
    byDay.set(day, { day, visitors: 0, pageViews: 0 });
  }

  const groups = (
    timeseries as { data?: { groups?: { all?: unknown[] } } }
  )?.data?.groups?.all;

  if (Array.isArray(groups)) {
    for (const bucket of groups) {
      const entry = bucket as { key?: unknown; total?: unknown; devices?: unknown };

      if (typeof entry.key !== "string") {
        continue;
      }

      const day = bucketDay(entry.key);
      const point = day ? byDay.get(day) : undefined;

      if (!day || !point) {
        continue;
      }

      const pageViews = typeof entry.total === "number" ? entry.total : 0;
      const visitors = typeof entry.devices === "number" ? entry.devices : 0;

      point.pageViews += pageViews;
      // Vercel counts distinct devices per bucket. Summing hourly buckets
      // double counts anyone who spans two hours, so this is an upper bound on
      // daily visitors rather than an exact figure.
      point.visitors += visitors;

      const hour = bucketHour(entry.key);

      if (hour !== null) {
        const key = `${day}T${hour}`;
        const existing = byHour.get(key);

        if (existing) {
          existing.pageViews += pageViews;
          existing.visitors += visitors;
        } else {
          byHour.set(key, { day, hour, visitors, pageViews });
        }
      }
    }
  }

  const countryRows = readRows(countries);

  return {
    series: Array.from(byDay.values()),
    hours: Array.from(byHour.values()).sort(
      (a, b) => a.day.localeCompare(b.day) || a.hour - b.hour,
    ),
    // Window totals come from the breakdowns, which are deduplicated across the
    // whole window by Vercel and are therefore more accurate than summing days.
    visitors: countryRows.reduce((sum, row) => sum + row.visitors, 0),
    pageViews: countryRows.reduce((sum, row) => sum + row.hits, 0),
    paths: readRows(paths),
    referrers: readRows(referrers),
    countries: countryRows,
    browsers: readRows(browsers),
    operatingSystems: readRows(operatingSystems),
  };
}

const cachedVercelTraffic = unstable_cache(fetchVercelTraffic, ["vercel-traffic"], {
  revalidate: CACHE_SECONDS,
});

/**
 * Visitors on the site right now, straight from Vercel.
 *
 * Our own beacon knows *who* is online, but only for people who have loaded a
 * page since it shipped. Vercel counts everyone, so it is the authority on the
 * number while the beacon supplies the identities.
 */
async function fetchRealtimeVisitors(): Promise<number | null> {
  const config = getVercelAnalyticsConfig();

  // Thrown rather than returned, for the same reason as the traffic lookup.
  if (!config) {
    throw new Error("Vercel analytics is not configured");
  }

  const payload = (await call(config, "realtime", {})) as {
    devices?: unknown;
    total?: unknown;
  };

  if (typeof payload?.devices === "number") {
    return payload.devices;
  }

  return typeof payload?.total === "number" ? payload.total : null;
}

/**
 * Briefly cached rather than uncached.
 *
 * It has to stay live to be worth showing, but an uncached call put a Vercel
 * round trip on the critical path of every overview and visitors render. Thirty
 * seconds is well inside the minute the page polls on, so the number is never
 * visibly stale.
 */
const cachedRealtime = unstable_cache(fetchRealtimeVisitors, ["vercel-realtime"], {
  revalidate: 30,
});

export async function getRealtimeVisitors(): Promise<number | null> {
  if (!getVercelAnalyticsConfig()) {
    return null;
  }

  try {
    return await cachedRealtime();
  } catch (error) {
    console.error("Vercel analytics realtime lookup failed", error);
    return null;
  }
}

/** Returns null when Vercel analytics is unavailable, so callers can fall back. */
export async function getVercelTraffic(range: {
  from: string;
  to: string;
}): Promise<VercelTraffic | null> {
  // Checked out here, outside the cache: a `null` cached for a missing token
  // would keep this range on the beacon for the whole revalidate window even
  // after the token was added, which is exactly what happened when the token
  // first shipped.
  if (!getVercelAnalyticsConfig()) {
    return null;
  }

  try {
    return await cachedVercelTraffic(range.from, range.to);
  } catch (error) {
    // Logged, not swallowed: without this a rejected token and an absent one
    // look identical from the outside.
    console.error("Vercel analytics traffic lookup failed", error);
    return null;
  }
}
