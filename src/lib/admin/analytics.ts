import "server-only";

import { type DateRange, rangeToTimestamps } from "@/lib/admin/ranges";
import type { SiteSessionRow } from "@/lib/database.types";
import { callRpc } from "@/lib/admin/db";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Visitor analytics for the admin dashboard, backed by our own beacon rather
 * than Vercel Analytics, whose API is not queryable on this plan and cannot
 * answer "who is online right now".
 */

/** A session is "online" while it has been seen within this window. */
export const ONLINE_WINDOW_MINUTES = 5;

export type TrafficDay = {
  day: string;
  visitors: number;
  pageViews: number;
  signedInVisitors: number;
  newVisitors: number;
};

export type TrafficBreakdown = {
  paths: Array<{ value: string; hits: number }>;
  referrers: Array<{ value: string; hits: number }>;
  countries: Array<{ value: string; hits: number }>;
  devices: Array<{ value: string; hits: number }>;
};

export type OnlineVisitor = {
  sessionId: string;
  userId: string | null;
  email: string | null;
  fullName: string | null;
  lastPath: string | null;
  lastSeenAt: string;
  country: string | null;
  deviceType: string | null;
  pageViews: number;
};

export type TrafficSummary = {
  visitors: number;
  pageViews: number;
  newVisitors: number;
  signedInVisitors: number;
  previousVisitors: number;
  onlineNow: number;
  series: TrafficDay[];
};

export async function getTrafficSeries(range: {
  from: string;
  to: string;
}): Promise<TrafficDay[]> {
  const serviceRole = createSupabaseServiceRoleClient();
  const { data, error } = await callRpc(serviceRole, "site_traffic_daily", {
    p_from: range.from,
    p_to: range.to,
  });

  if (error) {
    throw new Error(`Could not load traffic history: ${error.message}`);
  }

  return (
    (data ?? []) as Array<{
      day: string;
      visitors: number;
      page_views: number;
      signed_in_visitors: number;
      new_visitors: number;
    }>
  ).map((row) => ({
    day: row.day,
    visitors: Number(row.visitors ?? 0),
    pageViews: Number(row.page_views ?? 0),
    signedInVisitors: Number(row.signed_in_visitors ?? 0),
    newVisitors: Number(row.new_visitors ?? 0),
  }));
}

export async function getTrafficBreakdown(range: {
  from: string;
  to: string;
}): Promise<TrafficBreakdown> {
  const serviceRole = createSupabaseServiceRoleClient();
  const { fromIso, toIso } = rangeToTimestamps(range);

  const { data, error } = await callRpc(serviceRole, "site_traffic_breakdown", {
    p_from: fromIso,
    p_to: toIso,
    p_limit: 10,
  });

  if (error) {
    throw new Error(`Could not load the traffic breakdown: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    dimension: string;
    value: string;
    hits: number;
  }>;

  const pick = (dimension: string) =>
    rows
      .filter((row) => row.dimension === dimension)
      .map((row) => ({ value: row.value, hits: Number(row.hits ?? 0) }));

  return {
    paths: pick("path"),
    referrers: pick("referrer"),
    countries: pick("country"),
    devices: pick("device"),
  };
}

export async function getOnlineVisitors(): Promise<OnlineVisitor[]> {
  const serviceRole = createSupabaseServiceRoleClient();
  const since = new Date(
    Date.now() - ONLINE_WINDOW_MINUTES * 60 * 1000,
  ).toISOString();

  const { data, error } = await serviceRole
    .from("site_sessions")
    .select("*")
    .gte("last_seen_at", since)
    .eq("is_bot", false)
    .order("last_seen_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Could not load who is online: ${error.message}`);
  }

  const sessions = (data ?? []) as SiteSessionRow[];
  const userIds = Array.from(
    new Set(
      sessions
        .map((session) => session.user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const profiles = new Map<string, { email: string | null; fullName: string | null }>();

  if (userIds.length > 0) {
    const { data: profileRows } = await serviceRole
      .from("profiles")
      .select("id, email, full_name")
      .in("id", userIds);

    for (const row of (profileRows ?? []) as Array<{
      id: string;
      email: string | null;
      full_name: string | null;
    }>) {
      profiles.set(row.id, { email: row.email, fullName: row.full_name });
    }
  }

  return sessions.map((session) => {
    const profile = session.user_id ? profiles.get(session.user_id) : undefined;

    return {
      sessionId: session.id,
      userId: session.user_id,
      email: profile?.email ?? null,
      fullName: profile?.fullName ?? null,
      lastPath: session.last_path,
      lastSeenAt: session.last_seen_at,
      country: session.country,
      deviceType: session.device_type,
      pageViews: session.page_views,
    };
  });
}

export async function getTrafficSummary(range: DateRange): Promise<TrafficSummary> {
  const [series, previousSeries, online] = await Promise.all([
    getTrafficSeries(range),
    range.previous
      ? getTrafficSeries(range.previous)
      : Promise.resolve([] as TrafficDay[]),
    getOnlineVisitors(),
  ]);

  const sum = (rows: TrafficDay[], key: keyof TrafficDay) =>
    rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);

  return {
    // Daily visitor counts are distinct per day, so a multi-day total counts a
    // returning visitor once per day they came back. That is the standard
    // reading of "visits in this window".
    visitors: sum(series, "visitors"),
    pageViews: sum(series, "pageViews"),
    newVisitors: sum(series, "newVisitors"),
    signedInVisitors: sum(series, "signedInVisitors"),
    previousVisitors: sum(previousSeries, "visitors"),
    onlineNow: online.length,
    series,
  };
}
