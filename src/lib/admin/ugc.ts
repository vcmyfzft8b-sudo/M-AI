import "server-only";

import { cache } from "react";

import {
  addDays,
  type DateRange,
  eachDay,
  type RangePreset,
  rangeToTimestamps,
  resolveRange,
  todayInReportZone,
} from "@/lib/admin/ranges";
import type {
  UgcCreatorAccountRow,
  UgcCreatorRow,
  UgcVideoRow,
} from "@/lib/database.types";
import { callRpc, updateIn } from "@/lib/admin/db";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export type CreatorWithAccounts = UgcCreatorRow & {
  accounts: UgcCreatorAccountRow[];
};

export type CreatorMetrics = {
  creatorId: string;
  /** Views gained inside the window, from day-over-day snapshot deltas. */
  viewsGained: number;
  likesGained: number;
  commentsGained: number;
  sharesGained: number;
  /** Memo AI videos posted inside the window. */
  videosPosted: number;
  /** Lifetime views across every Memo AI video, regardless of window. */
  totalViews: number;
  totalVideos: number;
  /**
   * Lifetime saves. TikTok's collect count is not part of the daily snapshot
   * deltas, so this is a running total rather than a windowed figure.
   */
  totalSaves: number;
  followers: number;
  followersGained: number;
  /** Interactions per view across the window, as a fraction. */
  engagementRate: number;
};

export type DailyPoint = {
  day: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  videosPosted: number;
};

type DeltaRow = {
  day: string;
  creator_id: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  videos_posted: number;
};

/*
 * The reads below are wrapped in React's `cache` so that one request runs
 * each of them once, however many panels ask. The layout and the overview
 * both count the review queue, the overview and the finance summary both
 * want the same day's deltas, and so on — before this each caller paid for
 * its own round trip to the database. `cache` keys on argument identity, so
 * the wrapped functions take primitives rather than range objects.
 */

const cachedCreators = cache(async (includeArchived: boolean) => {
  const serviceRole = createSupabaseServiceRoleClient();
  let query = serviceRole
    .from("ugc_creators")
    .select("*, accounts:ugc_creator_accounts(*)")
    .order("name", { ascending: true });

  if (!includeArchived) {
    query = query.neq("status", "archived");
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Could not load creators: ${error.message}`);
  }

  return (data ?? []) as unknown as CreatorWithAccounts[];
});

export async function listCreators(options?: {
  includeArchived?: boolean;
}): Promise<CreatorWithAccounts[]> {
  return cachedCreators(options?.includeArchived ?? false);
}

export async function getCreator(id: string): Promise<CreatorWithAccounts | null> {
  const serviceRole = createSupabaseServiceRoleClient();
  const { data, error } = await serviceRole
    .from("ugc_creators")
    .select("*, accounts:ugc_creator_accounts(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load that creator: ${error.message}`);
  }

  return (data as unknown as CreatorWithAccounts | null) ?? null;
}

const cachedDeltas = cache(
  async (from: string, to: string, onlyMemo: boolean): Promise<DeltaRow[]> => {
    const serviceRole = createSupabaseServiceRoleClient();
    const { data, error } = await callRpc(serviceRole, "ugc_daily_view_deltas", {
      p_from: from,
      p_to: to,
      p_only_memo: onlyMemo,
    });

    if (error) {
      throw new Error(`Could not load view history: ${error.message}`);
    }

    return (data ?? []) as DeltaRow[];
  },
);

/** Day-by-day deltas for a window, optionally narrowed to one creator. */
export async function getDailyDeltas(
  range: { from: string; to: string },
  options?: { creatorId?: string; onlyMemo?: boolean },
): Promise<DeltaRow[]> {
  const rows = await cachedDeltas(range.from, range.to, options?.onlyMemo ?? true);

  return options?.creatorId
    ? rows.filter((row) => row.creator_id === options.creatorId)
    : rows;
}

/** Collapses per-creator deltas into one continuous series, zero-filling gaps. */
export function toDailySeries(
  rows: DeltaRow[],
  range: { from: string; to: string },
): DailyPoint[] {
  const byDay = new Map<string, DailyPoint>();

  for (const day of eachDay(range.from, range.to)) {
    byDay.set(day, {
      day,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      videosPosted: 0,
    });
  }

  for (const row of rows) {
    const point = byDay.get(row.day);

    if (!point) {
      continue;
    }

    point.views += Number(row.views ?? 0);
    point.likes += Number(row.likes ?? 0);
    point.comments += Number(row.comments ?? 0);
    point.shares += Number(row.shares ?? 0);
    point.videosPosted += Number(row.videos_posted ?? 0);
  }

  return Array.from(byDay.values());
}

/**
 * Per-creator totals for a window.
 *
 * "Views gained" comes from snapshot deltas rather than summing lifetime view
 * counts, because a video posted last week keeps accruing views this week and
 * those views belong to the day they happened.
 */
export async function getCreatorMetrics(
  // A promise is accepted so a page can batch this with the creator list it
  // depends on instead of waiting for the list first.
  creatorsOrPromise: CreatorWithAccounts[] | Promise<CreatorWithAccounts[]>,
  range: { from: string; to: string },
): Promise<Map<string, CreatorMetrics>> {
  // Four independent reads, so they go out together rather than one after
  // another: the round trip, not the query, is what a dashboard render waits on.
  const [creators, deltas, lifetime, followerSnapshots] = await Promise.all([
    creatorsOrPromise,
    getDailyDeltas(range, { onlyMemo: true }),
    cachedLifetimeTotals(),
    cachedFollowerSnapshots(addDays(range.from, -1), range.to),
  ]);

  const metrics = new Map<string, CreatorMetrics>();

  for (const creator of creators) {
    metrics.set(creator.id, {
      creatorId: creator.id,
      viewsGained: 0,
      likesGained: 0,
      commentsGained: 0,
      sharesGained: 0,
      videosPosted: 0,
      totalViews: 0,
      totalVideos: 0,
      totalSaves: 0,
      followers: creator.accounts.reduce(
        (sum, account) => sum + (account.follower_count ?? 0),
        0,
      ),
      followersGained: 0,
      engagementRate: 0,
    });
  }

  for (const row of deltas) {
    const entry = metrics.get(row.creator_id);

    if (!entry) {
      continue;
    }

    entry.viewsGained += Number(row.views ?? 0);
    entry.likesGained += Number(row.likes ?? 0);
    entry.commentsGained += Number(row.comments ?? 0);
    entry.sharesGained += Number(row.shares ?? 0);
    entry.videosPosted += Number(row.videos_posted ?? 0);
  }

  for (const row of lifetime) {
    const entry = metrics.get(row.creator_id);

    if (!entry) {
      continue;
    }

    entry.totalViews += Number(row.views ?? 0);
    entry.totalSaves += Number(row.saves ?? 0);
    entry.totalVideos += 1;
  }

  addFollowerGrowth(metrics, followerSnapshots);

  for (const entry of metrics.values()) {
    const interactions =
      entry.likesGained + entry.commentsGained + entry.sharesGained;
    entry.engagementRate =
      entry.viewsGained > 0 ? interactions / entry.viewsGained : 0;
  }

  return metrics;
}

/** Lifetime Memo AI totals per creator, independent of any window. */
const cachedLifetimeTotals = cache(async () => {
  const serviceRole = createSupabaseServiceRoleClient();
  const { data } = await serviceRole
    .from("ugc_videos")
    .select("creator_id, views, saves")
    .eq("classification", "memo");

  return (data ?? []) as Array<{
    creator_id: string;
    views: number;
    saves: number;
  }>;
});

type FollowerSnapshot = {
  creator_id: string;
  captured_on: string;
  follower_count: number | null;
};

/**
 * Daily follower snapshots between two days, oldest first. `from` is the
 * day before the window so a window that starts today still has a baseline.
 */
const cachedFollowerSnapshots = cache(
  async (from: string, to: string): Promise<FollowerSnapshot[]> => {
    const serviceRole = createSupabaseServiceRoleClient();
    const { data } = await serviceRole
      .from("ugc_account_stats")
      .select("creator_id, captured_on, follower_count")
      .gte("captured_on", from)
      .lte("captured_on", to)
      .order("captured_on", { ascending: true });

    return (data ?? []) as FollowerSnapshot[];
  },
);

/** Follower change across the window, from the first and last daily snapshots. */
function addFollowerGrowth(
  metrics: Map<string, CreatorMetrics>,
  snapshots: FollowerSnapshot[],
) {
  const first = new Map<string, number>();
  const last = new Map<string, number>();

  for (const row of snapshots) {
    if (row.follower_count === null) {
      continue;
    }

    if (!first.has(row.creator_id)) {
      first.set(row.creator_id, row.follower_count);
    }

    last.set(row.creator_id, row.follower_count);
  }

  for (const [creatorId, entry] of metrics) {
    const start = first.get(creatorId);
    const end = last.get(creatorId);

    if (typeof start === "number" && typeof end === "number") {
      entry.followersGained = end - start;
    }
  }
}

export type VideoWithContext = UgcVideoRow & {
  creatorName: string;
  handle: string;
};

export async function listVideos(options: {
  creatorId?: string;
  classification?: "memo" | "personal" | "unknown";
  range?: { from: string; to: string };
  limit?: number;
}): Promise<VideoWithContext[]> {
  const serviceRole = createSupabaseServiceRoleClient();

  let query = serviceRole
    .from("ugc_videos")
    .select("*, creator:ugc_creators(name), account:ugc_creator_accounts(handle)")
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(options.limit ?? 100);

  if (options.creatorId) {
    query = query.eq("creator_id", options.creatorId);
  }

  if (options.classification) {
    query = query.eq("classification", options.classification);
  }

  if (options.range) {
    const { fromIso, toIso } = rangeToTimestamps(options.range);
    query = query.gte("posted_at", fromIso).lt("posted_at", toIso);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Could not load videos: ${error.message}`);
  }

  return ((data ?? []) as unknown as Array<
    UgcVideoRow & {
      creator: { name: string } | null;
      account: { handle: string } | null;
    }
  >).map((row) => ({
    ...row,
    creatorName: row.creator?.name ?? "Unknown",
    handle: row.account?.handle ?? "",
  }));
}

/** Counted once per request: the layout badge and the overview banner share it. */
export const countVideosNeedingReview = cache(async (): Promise<number> => {
  const serviceRole = createSupabaseServiceRoleClient();
  const { count } = await serviceRole
    .from("ugc_videos")
    .select("id", { count: "exact", head: true })
    .eq("classification", "unknown");

  return count ?? 0;
});

export type CampaignTotals = {
  viewsGained: number;
  likesGained: number;
  commentsGained: number;
  sharesGained: number;
  videosPosted: number;
  activeCreators: number;
  totalFollowers: number;
  totalSaves: number;
  engagementRate: number;
};

export function sumMetrics(
  metrics: Map<string, CreatorMetrics>,
): CampaignTotals {
  const totals: CampaignTotals = {
    viewsGained: 0,
    likesGained: 0,
    commentsGained: 0,
    sharesGained: 0,
    videosPosted: 0,
    activeCreators: 0,
    totalFollowers: 0,
    totalSaves: 0,
    engagementRate: 0,
  };

  for (const entry of metrics.values()) {
    totals.viewsGained += entry.viewsGained;
    totals.likesGained += entry.likesGained;
    totals.commentsGained += entry.commentsGained;
    totals.sharesGained += entry.sharesGained;
    totals.videosPosted += entry.videosPosted;
    totals.totalFollowers += entry.followers;
    totals.totalSaves += entry.totalSaves;

    // "Active" means the creator actually moved a number in this window.
    if (entry.viewsGained > 0 || entry.videosPosted > 0) {
      totals.activeCreators += 1;
    }
  }

  const interactions =
    totals.likesGained + totals.commentsGained + totals.sharesGained;
  totals.engagementRate =
    totals.viewsGained > 0 ? interactions / totals.viewsGained : 0;

  return totals;
}

/**
 * The window a dashboard page shows for a preset.
 *
 * Only the all-time window needs to know where the data starts; every other
 * preset is fixed by the calendar, so they skip that round trip.
 */
export async function resolveDashboardRange(preset: RangePreset): Promise<DateRange> {
  return resolveRange(preset, {
    earliestDay: preset === "all" ? await getEarliestDataDay() : null,
  });
}

/** The earliest day we hold any UGC data, used to bound the "all time" range. */
export const getEarliestDataDay = cache(async (): Promise<string | null> => {
  const serviceRole = createSupabaseServiceRoleClient();
  const { data } = await serviceRole
    .from("ugc_video_stats")
    .select("captured_on")
    .order("captured_on", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data as { captured_on: string } | null)?.captured_on ?? null;
});

export async function setVideoClassification(options: {
  videoId: string;
  classification: "memo" | "personal" | "unknown";
  /** `false` hands the video back to the automatic classifier. */
  lock: boolean;
  actor: string;
}) {
  const serviceRole = createSupabaseServiceRoleClient();

  const { error } = await updateIn(serviceRole, "ugc_videos", {
    classification: options.classification,
    classification_source: options.lock ? "manual" : "rule",
    classification_locked: options.lock,
    classification_confidence: options.lock ? 1 : null,
    classification_reason: options.lock
      ? `Set by ${options.actor}.`
      : "Handed back to automatic detection.",
    classified_at: new Date().toISOString(),
  }).eq("id", options.videoId);

  if (error) {
    throw new Error(`Could not update that video: ${error.message}`);
  }
}

export function todayKey() {
  return todayInReportZone();
}

/**
 * Campaign views over a rolling baseline window, for valuing a view.
 *
 * Deliberately independent of the range the admin is looking at: the rate
 * should not lurch when someone switches to "today", and a longer window is a
 * steadier divisor.
 */
export async function getBaselineCampaignViews(days: number): Promise<{
  views: number;
  from: string;
  to: string;
}> {
  const to = todayInReportZone();
  const from = addDays(to, -(days - 1));
  const rows = await getDailyDeltas({ from, to }, { onlyMemo: true });

  return {
    views: rows.reduce((sum, row) => sum + Number(row.views ?? 0), 0),
    from,
    to,
  };
}
