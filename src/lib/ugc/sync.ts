import "server-only";

import { todayInReportZone } from "@/lib/admin/ranges";
import type {
  Database,
  Json,
  UgcClassificationRuleRow,
  UgcCreatorAccountRow,
  UgcCreatorRow,
  UgcSyncRunRow,
  UgcVideoRow,
} from "@/lib/database.types";
import { insertInto, updateIn, upsertInto } from "@/lib/admin/db";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  ApifyError,
  type CollectedAccount,
  type CollectedBatch,
  type CollectedVideo,
  getRun,
  isApifyConfigured,
  isRunFinished,
  readRunDataset,
  startTikTokRun,
} from "@/lib/ugc/apify";
import {
  type AiClassificationInput,
  classifyWithAi,
  isAiClassificationConfigured,
  toClassificationResult,
} from "@/lib/ugc/ai-classification";
import {
  type ClassificationResult,
  classifyVideo,
  type ClassificationRule,
} from "@/lib/ugc/classification";
import { fetchTikTokProfileSnapshot } from "@/lib/ugc/tiktok";

type UgcVideoInsert = Database["public"]["Tables"]["ugc_videos"]["Insert"];

/**
 * How many recent posts to pull per creator on each run.
 *
 * Apify bills per post scraped, so this is the main cost lever: 14 accounts at
 * 30 posts costs roughly $0.60 a run. Raise it for a one-off deep backfill,
 * lower it for cheaper daily upkeep. Older posts already in the database keep
 * their history either way; they simply stop being re-read for fresh counts.
 */
const DEFAULT_VIDEOS_PER_PROFILE = 20;

function videosPerProfile(): number {
  const configured = Number(process.env.UGC_SYNC_POSTS_PER_PROFILE);

  return Number.isFinite(configured) && configured > 0 && configured <= 200
    ? Math.floor(configured)
    : DEFAULT_VIDEOS_PER_PROFILE;
}

type SyncDetail = {
  runId?: string;
  datasetId?: string;
  handles?: string[];
};

type AccountWithCreator = UgcCreatorAccountRow & {
  creator: Pick<UgcCreatorRow, "id" | "promo_codes" | "status">;
};

export type SyncStartResult =
  | { started: true; syncRunId: string; apifyRunId: string; handles: string[] }
  | { started: false; reason: string; syncRunId?: string };

export type SyncPollResult = {
  status: UgcSyncRunRow["status"];
  syncRunId: string | null;
  videosSeen: number;
  videosCreated: number;
  videosUpdated: number;
  accountsSynced: number;
  error: string | null;
};

function readDetail(value: Json | null): SyncDetail {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as SyncDetail)
    : {};
}

async function loadClassificationRules(): Promise<ClassificationRule[]> {
  const serviceRole = createSupabaseServiceRoleClient();
  const { data, error } = await serviceRole
    .from("ugc_classification_rules")
    .select("*")
    .eq("active", true);

  if (error) {
    throw new Error(`Could not load classification rules: ${error.message}`);
  }

  return ((data ?? []) as UgcClassificationRuleRow[]).map((rule) => ({
    kind: rule.kind,
    pattern: rule.pattern,
    weight: Number(rule.weight),
  }));
}

async function loadSyncableAccounts(): Promise<AccountWithCreator[]> {
  const serviceRole = createSupabaseServiceRoleClient();
  const { data, error } = await serviceRole
    .from("ugc_creator_accounts")
    .select("*, creator:ugc_creators!inner(id, promo_codes, status)")
    .eq("platform", "tiktok")
    .eq("status", "active");

  if (error) {
    throw new Error(`Could not load creator accounts: ${error.message}`);
  }

  // An archived or paused creator keeps its history but stops costing scrape
  // credits.
  return ((data ?? []) as unknown as AccountWithCreator[]).filter(
    (account) => account.creator?.status === "active",
  );
}

/** Returns the sync run that is still waiting on Apify, if there is one. */
export async function getPendingSyncRun(): Promise<UgcSyncRunRow | null> {
  const serviceRole = createSupabaseServiceRoleClient();
  const { data } = await serviceRole
    .from("ugc_sync_runs")
    .select("*")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as UgcSyncRunRow | null) ?? null;
}

export async function getLatestSyncRun(): Promise<UgcSyncRunRow | null> {
  const serviceRole = createSupabaseServiceRoleClient();
  const { data } = await serviceRole
    .from("ugc_sync_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as UgcSyncRunRow | null) ?? null;
}

/** A run still marked `running` after this long is treated as dead. */
const STALE_RUN_MS = 60 * 60 * 1000;

export async function startSync(options: {
  trigger: "manual" | "cron";
  startedBy: string;
  /** Overrides the configured per-creator pull, for a one-off deep backfill. */
  postsPerProfile?: number;
  /**
   * Restricts the run to these handles. Scraping is billed per post, so adding
   * one account should not mean paying to re-read every other one.
   */
  handles?: string[];
}): Promise<SyncStartResult> {
  if (!isApifyConfigured()) {
    return {
      started: false,
      reason:
        "APIFY_TOKEN is not set. Add it to the environment to collect TikTok stats automatically.",
    };
  }

  const serviceRole = createSupabaseServiceRoleClient();
  const pending = await getPendingSyncRun();

  if (pending) {
    const age = Date.now() - new Date(pending.started_at).getTime();

    if (age < STALE_RUN_MS) {
      return {
        started: false,
        reason: "A sync is already running.",
        syncRunId: pending.id,
      };
    }

    // Never leave a dead run blocking every future sync.
    await updateIn(serviceRole, "ugc_sync_runs", {
        status: "error",
        error: "Run abandoned: still unfinished after an hour.",
        finished_at: new Date().toISOString(),
      })
      .eq("id", pending.id);
  }

  const accounts = await loadSyncableAccounts();
  const wanted = options.handles?.map((handle) => handle.toLowerCase());
  const handles = Array.from(
    new Set(
      accounts
        .filter(
          (account) => !wanted || wanted.includes(account.handle.toLowerCase()),
        )
        .map((account) => account.handle),
    ),
  );

  if (handles.length === 0) {
    return { started: false, reason: "There are no active TikTok accounts to sync." };
  }

  const { data: created, error: createError } = await insertInto(serviceRole, "ugc_sync_runs", {
      source: "apify",
      trigger: options.trigger,
      status: "running",
      accounts_total: handles.length,
      started_by: options.startedBy,
      detail: { handles } satisfies SyncDetail as Json,
    })
    .select("id")
    .single();

  if (createError || !created) {
    throw new Error(`Could not record the sync run: ${createError?.message}`);
  }

  const syncRunId = (created as { id: string }).id;

  try {
    const run = await startTikTokRun({
      handles,
      maxPerProfile: options.postsPerProfile ?? videosPerProfile(),
    });

    await updateIn(serviceRole, "ugc_sync_runs", {
        detail: {
          handles,
          runId: run.id,
          datasetId: run.defaultDatasetId,
        } satisfies SyncDetail as Json,
      })
      .eq("id", syncRunId);

    return { started: true, syncRunId, apifyRunId: run.id, handles };
  } catch (error) {
    const message =
      error instanceof ApifyError || error instanceof Error
        ? error.message
        : "Unknown Apify error.";

    await updateIn(serviceRole, "ugc_sync_runs", {
        status: "error",
        error: message,
        finished_at: new Date().toISOString(),
      })
      .eq("id", syncRunId);

    return { started: false, reason: message, syncRunId };
  }
}

/**
 * Checks the in-flight Apify run and, once it has finished, ingests its
 * dataset. Safe to call repeatedly: it is a no-op while the run is still going
 * and there is nothing to do when no run is pending.
 */
export async function pollAndIngest(): Promise<SyncPollResult> {
  const serviceRole = createSupabaseServiceRoleClient();
  const pending = await getPendingSyncRun();

  if (!pending) {
    return {
      status: "ok",
      syncRunId: null,
      videosSeen: 0,
      videosCreated: 0,
      videosUpdated: 0,
      accountsSynced: 0,
      error: null,
    };
  }

  const detail = readDetail(pending.detail);

  if (!detail.runId) {
    await updateIn(serviceRole, "ugc_sync_runs", {
        status: "error",
        error: "The run was never handed to Apify.",
        finished_at: new Date().toISOString(),
      })
      .eq("id", pending.id);

    return {
      status: "error",
      syncRunId: pending.id,
      videosSeen: 0,
      videosCreated: 0,
      videosUpdated: 0,
      accountsSynced: 0,
      error: "The run was never handed to Apify.",
    };
  }

  let run;

  try {
    run = await getRun(detail.runId);
  } catch (error) {
    return {
      status: "running",
      syncRunId: pending.id,
      videosSeen: 0,
      videosCreated: 0,
      videosUpdated: 0,
      accountsSynced: 0,
      error: error instanceof Error ? error.message : "Could not reach Apify.",
    };
  }

  if (!isRunFinished(run.status)) {
    return {
      status: "running",
      syncRunId: pending.id,
      videosSeen: 0,
      videosCreated: 0,
      videosUpdated: 0,
      accountsSynced: 0,
      error: null,
    };
  }

  if (run.status !== "SUCCEEDED") {
    const message = `Apify run ${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ""}`;

    await updateIn(serviceRole, "ugc_sync_runs", {
        status: "error",
        error: message,
        finished_at: new Date().toISOString(),
      })
      .eq("id", pending.id);

    return {
      status: "error",
      syncRunId: pending.id,
      videosSeen: 0,
      videosCreated: 0,
      videosUpdated: 0,
      accountsSynced: 0,
      error: message,
    };
  }

  const batch = await readRunDataset(run.defaultDatasetId || detail.datasetId || "");
  const ingested = await ingestBatch(batch, { expectedHandles: detail.handles });

  // Any video seen for the first time gets its history seeded at its post date,
  // so a first sync does not pile a whole back catalogue onto today.
  await backfillPostedSnapshots().catch(() => undefined);

  await updateIn(serviceRole, "ugc_sync_runs", {
      status: ingested.skippedHandles.length > 0 ? "partial" : "ok",
      accounts_synced: ingested.accountsSynced,
      videos_seen: ingested.videosSeen,
      videos_created: ingested.videosCreated,
      videos_updated: ingested.videosUpdated,
      error:
        ingested.skippedHandles.length > 0
          ? `No data returned for: ${ingested.skippedHandles.join(", ")}`
          : null,
      finished_at: new Date().toISOString(),
      detail: {
        ...detail,
        datasetId: run.defaultDatasetId,
      } satisfies SyncDetail as Json,
    })
    .eq("id", pending.id);

  return {
    status: ingested.skippedHandles.length > 0 ? "partial" : "ok",
    syncRunId: pending.id,
    videosSeen: ingested.videosSeen,
    videosCreated: ingested.videosCreated,
    videosUpdated: ingested.videosUpdated,
    accountsSynced: ingested.accountsSynced,
    error: null,
  };
}

export type IngestResult = {
  videosSeen: number;
  videosCreated: number;
  videosUpdated: number;
  accountsSynced: number;
  skippedHandles: string[];
};

/**
 * Writes a collected batch into the database: video rows, a dated stats
 * snapshot per video, and refreshed account counters.
 */
export async function ingestBatch(
  batch: CollectedBatch,
  options?: {
    /**
     * The handles this run actually asked for. A run scoped to one account
     * would otherwise report every account it never requested as "skipped",
     * and be marked partial for no reason.
     */
    expectedHandles?: string[];
  },
): Promise<IngestResult> {
  const serviceRole = createSupabaseServiceRoleClient();
  const accounts = await loadSyncableAccounts();
  const rules = await loadClassificationRules();
  const capturedOn = todayInReportZone();

  const accountsByHandle = new Map(
    accounts.map((account) => [account.handle.toLowerCase(), account]),
  );

  const result: IngestResult = {
    videosSeen: 0,
    videosCreated: 0,
    videosUpdated: 0,
    accountsSynced: 0,
    skippedHandles: [],
  };

  const seenHandles = new Set<string>();

  // Existing rows tell us which classifications an admin has pinned by hand.
  const existingByPlatformId = new Map<string, UgcVideoRow>();
  const platformIds = batch.videos.map((video) => video.platformVideoId);

  for (let index = 0; index < platformIds.length; index += 200) {
    const slice = platformIds.slice(index, index + 200);
    const { data } = await serviceRole
      .from("ugc_videos")
      .select("*")
      .eq("platform", "tiktok")
      .in("platform_video_id", slice);

    for (const row of (data ?? []) as UgcVideoRow[]) {
      existingByPlatformId.set(row.platform_video_id, row);
    }
  }

  const videoRows: UgcVideoInsert[] = [];
  // Posts on mixed accounts get a second opinion from the model. Dedicated and
  // personal accounts are settled by their mode alone, so they are skipped.
  const aiCandidates: AiClassificationInput[] = [];
  const ruleVerdicts = new Map<string, ClassificationResult>();
  const statsByPlatformId = new Map<
    string,
    { views: number; likes: number; comments: number; shares: number; saves: number }
  >();

  const now = new Date().toISOString();

  for (const video of batch.videos) {
    const account = accountsByHandle.get(video.handle.toLowerCase());

    if (!account) {
      // A handle we no longer track, or one that was renamed mid-campaign.
      continue;
    }

    seenHandles.add(account.handle.toLowerCase());
    result.videosSeen += 1;

    const existing = existingByPlatformId.get(video.platformVideoId);
    const promoCodes = account.creator?.promo_codes ?? [];

    const classification = classifyVideo(
      {
        caption: video.caption,
        hashtags: video.hashtags,
        mentions: video.mentions,
        contentMode: account.content_mode,
        promoCodes,
      },
      rules,
    );

    // A manual decision is final: re-running the classifier must never quietly
    // move a video an admin has already judged.
    const keepManual = existing?.classification_locked === true;

    if (!keepManual && account.content_mode === "mixed") {
      ruleVerdicts.set(video.platformVideoId, classification);
      aiCandidates.push({
        id: video.platformVideoId,
        caption: video.caption,
        hashtags: video.hashtags,
        mentions: video.mentions,
        creatorName: account.handle,
        promoCodes,
        ruleVerdict: classification,
      });
    }

    videoRows.push({
      account_id: account.id,
      creator_id: account.creator_id,
      platform: "tiktok" as const,
      platform_video_id: video.platformVideoId,
      url: video.url,
      caption: video.caption,
      hashtags: video.hashtags,
      mentions: video.mentions,
      cover_url: video.coverUrl,
      duration_seconds: video.durationSeconds,
      posted_at: video.postedAt,
      views: video.views,
      likes: video.likes,
      comments: video.comments,
      shares: video.shares,
      saves: video.saves,
      last_synced_at: now,
      ...(keepManual
        ? {}
        : {
            classification: classification.classification,
            classification_source: classification.source,
            classification_confidence: classification.confidence,
            classification_reason: classification.reason,
            classified_at: now,
          }),
    });

    statsByPlatformId.set(video.platformVideoId, {
      views: video.views,
      likes: video.likes,
      comments: video.comments,
      shares: video.shares,
      saves: video.saves,
    });

    if (existing) {
      result.videosUpdated += 1;
    } else {
      result.videosCreated += 1;
    }
  }

  // The model reviews every mixed-account post before anything is written, so
  // the stored classification is the final one and the dashboard never briefly
  // shows a keyword guess.
  if (aiCandidates.length > 0 && isAiClassificationConfigured()) {
    const verdicts = await classifyWithAi(aiCandidates);

    for (const row of videoRows) {
      const platformVideoId = row.platform_video_id;
      const verdict = verdicts.get(platformVideoId);
      const ruleVerdict = ruleVerdicts.get(platformVideoId);

      if (!verdict || !ruleVerdict) {
        continue;
      }

      const resolved = toClassificationResult(verdict, ruleVerdict);
      row.classification = resolved.classification;
      row.classification_source = resolved.source;
      row.classification_confidence = resolved.confidence;
      row.classification_reason = resolved.reason;
    }
  }

  // Written in chunks rather than one row at a time. A per-video round trip
  // meant roughly three sequential requests per post, so a normal run of ~160
  // posts spent minutes in request latency alone and risked outliving the
  // serverless budget.
  const CHUNK = 100;
  const idByPlatformId = new Map<string, string>();

  for (let index = 0; index < videoRows.length; index += CHUNK) {
    const chunk = videoRows.slice(index, index + CHUNK);

    const { data, error } = await upsertInto(
      serviceRole,
      "ugc_videos",
      chunk,
      { onConflict: "platform,platform_video_id" },
    ).select("id, platform_video_id");

    if (error) {
      throw new Error(`Could not store videos: ${error.message}`);
    }

    for (const row of (data ?? []) as Array<{
      id: string;
      platform_video_id: string;
    }>) {
      idByPlatformId.set(row.platform_video_id, row.id);
    }
  }

  // One snapshot per video per day. Re-running on the same day overwrites it,
  // so the latest read of the day is the one that counts.
  const statRows = Array.from(statsByPlatformId.entries())
    .map(([platformVideoId, stats]) => {
      const videoId = idByPlatformId.get(platformVideoId);
      const account = accountsByHandle.get(
        (batch.videos.find((v) => v.platformVideoId === platformVideoId)?.handle ?? "")
          .toLowerCase(),
      );

      if (!videoId || !account) {
        return null;
      }

      return {
        video_id: videoId,
        account_id: account.id,
        creator_id: account.creator_id,
        captured_on: capturedOn,
        captured_at: now,
        ...stats,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  for (let index = 0; index < statRows.length; index += CHUNK) {
    const { error } = await upsertInto(
      serviceRole,
      "ugc_video_stats",
      statRows.slice(index, index + CHUNK),
      { onConflict: "video_id,captured_on" },
    );

    if (error) {
      throw new Error(`Could not store video stats: ${error.message}`);
    }
  }

  for (const collected of batch.accounts) {
    const account = accountsByHandle.get(collected.handle.toLowerCase());

    if (!account) {
      continue;
    }

    await writeAccountSnapshot(account, collected, capturedOn);
    result.accountsSynced += 1;
  }

  const expected = options?.expectedHandles?.map((handle) => handle.toLowerCase());

  result.skippedHandles = accounts
    .filter((account) => {
      const handle = account.handle.toLowerCase();

      if (expected && !expected.includes(handle)) {
        return false;
      }

      return !seenHandles.has(handle);
    })
    .map((account) => account.handle);

  return result;
}

async function writeAccountSnapshot(
  account: AccountWithCreator,
  collected: CollectedAccount,
  capturedOn: string,
) {
  const serviceRole = createSupabaseServiceRoleClient();

  await updateIn(serviceRole, "ugc_creator_accounts", {
      display_name: collected.displayName ?? account.display_name,
      avatar_url: collected.avatarUrl ?? account.avatar_url,
      bio: collected.bio ?? account.bio,
      platform_account_id: collected.accountId ?? account.platform_account_id,
      follower_count: collected.followerCount ?? account.follower_count,
      following_count: collected.followingCount ?? account.following_count,
      total_likes: collected.totalLikes ?? account.total_likes,
      video_count: collected.videoCount ?? account.video_count,
      last_synced_at: new Date().toISOString(),
      last_sync_status: "ok",
      last_sync_error: null,
    })
    .eq("id", account.id);

  await upsertInto(serviceRole, "ugc_account_stats", 
    {
      account_id: account.id,
      creator_id: account.creator_id,
      captured_on: capturedOn,
      follower_count: collected.followerCount,
      total_likes: collected.totalLikes,
      video_count: collected.videoCount,
      captured_at: new Date().toISOString(),
    },
    { onConflict: "account_id,captured_on" },
  );
}

/**
 * Refreshes follower counts straight from the public TikTok profile page.
 *
 * Free and API-key-less, so it is worth doing for a newly added creator to fill
 * the card in immediately, before the first paid scrape has run.
 */
export async function refreshAccountProfile(accountId: string): Promise<boolean> {
  const serviceRole = createSupabaseServiceRoleClient();
  const { data } = await serviceRole
    .from("ugc_creator_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();

  const account = data as UgcCreatorAccountRow | null;

  if (!account || account.platform !== "tiktok") {
    return false;
  }

  const snapshot = await fetchTikTokProfileSnapshot(account.handle);

  if (!snapshot) {
    await updateIn(serviceRole, "ugc_creator_accounts", {
        last_sync_status: "error",
        last_sync_error: "TikTok did not return a readable profile page.",
      })
      .eq("id", accountId);

    return false;
  }

  await updateIn(serviceRole, "ugc_creator_accounts", {
      display_name: snapshot.displayName ?? account.display_name,
      avatar_url: snapshot.avatarUrl ?? account.avatar_url,
      bio: snapshot.bio ?? account.bio,
      platform_account_id: snapshot.accountId ?? account.platform_account_id,
      sec_uid: snapshot.secUid ?? account.sec_uid,
      follower_count: snapshot.followerCount ?? account.follower_count,
      following_count: snapshot.followingCount ?? account.following_count,
      total_likes: snapshot.totalLikes ?? account.total_likes,
      video_count: snapshot.videoCount ?? account.video_count,
      last_synced_at: new Date().toISOString(),
      last_sync_status: "ok",
      last_sync_error: null,
    })
    .eq("id", accountId);

  await upsertInto(serviceRole, "ugc_account_stats", 
    {
      account_id: account.id,
      creator_id: account.creator_id,
      captured_on: todayInReportZone(),
      follower_count: snapshot.followerCount,
      total_likes: snapshot.totalLikes,
      video_count: snapshot.videoCount,
      captured_at: new Date().toISOString(),
    },
    { onConflict: "account_id,captured_on" },
  );

  return true;
}

/**
 * Seeds each video's first metrics snapshot at the day it was posted.
 *
 * TikTok publishes only a video's *current* cumulative counters — there is no
 * source, Apify included, for "how many views did this video have last
 * Tuesday". So a true day-by-day history of the past cannot be reconstructed.
 *
 * What this does instead is credit each video's discovered view count to the
 * day it was posted, rather than to the day we happened to first scrape it.
 * Without it, the very first sync would dump every creator's entire back
 * catalogue of views onto today and show a fake spike. With it, the chart reads
 * as "views from videos posted that day" for everything before the first sync,
 * and as true day-over-day accrual from the first sync onward.
 *
 * Existing snapshots are never touched, so this is safe to re-run.
 */
export async function backfillPostedSnapshots(options?: {
  sinceDays?: number;
}): Promise<{ seeded: number; skipped: number }> {
  const serviceRole = createSupabaseServiceRoleClient();
  const today = todayInReportZone();

  let query = serviceRole
    .from("ugc_videos")
    .select("id, account_id, creator_id, posted_at, views, likes, comments, shares, saves")
    .not("posted_at", "is", null);

  if (options?.sinceDays) {
    const since = new Date(
      Date.now() - options.sinceDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    query = query.gte("posted_at", since);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Could not read videos to backfill: ${error.message}`);
  }

  const videos = (data ?? []) as Array<{
    id: string;
    account_id: string;
    creator_id: string;
    posted_at: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
  }>;

  if (videos.length === 0) {
    return { seeded: 0, skipped: 0 };
  }

  // Videos that already have a snapshot from a previous day: those have a real
  // history, and seeding a synthetic one would corrupt their deltas.
  //
  // The check is deliberately "before today" rather than "any snapshot at all",
  // because ingestion writes today's snapshot before this runs — testing for
  // any snapshot would match every video and seed nothing.
  const hasEarlierHistory = new Set<string>();

  for (let index = 0; index < videos.length; index += 200) {
    const slice = videos.slice(index, index + 200).map((video) => video.id);
    const { data: rows } = await serviceRole
      .from("ugc_video_stats")
      .select("video_id")
      .in("video_id", slice)
      .lt("captured_on", today);

    for (const row of (rows ?? []) as Array<{ video_id: string }>) {
      hasEarlierHistory.add(row.video_id);
    }
  }

  const pending = videos.filter(
    (video) =>
      !hasEarlierHistory.has(video.id) &&
      // A video posted today already has today's snapshot; there is no earlier
      // day to credit it to.
      todayInReportZone(new Date(video.posted_at)) < today,
  );

  if (pending.length === 0) {
    return { seeded: 0, skipped: videos.length };
  }

  const rows = pending.map((video) => {
    return {
      video_id: video.id,
      account_id: video.account_id,
      creator_id: video.creator_id,
      captured_on: todayInReportZone(new Date(video.posted_at)),
      views: video.views,
      likes: video.likes,
      comments: video.comments,
      shares: video.shares,
      saves: video.saves,
      captured_at: new Date().toISOString(),
    };
  });

  for (let index = 0; index < rows.length; index += 200) {
    await upsertInto(serviceRole, "ugc_video_stats", rows.slice(index, index + 200), {
        onConflict: "video_id,captured_on",
        ignoreDuplicates: true,
      });
  }

  return { seeded: pending.length, skipped: videos.length - pending.length };
}

/**
 * Re-runs detection over stored videos, respecting manual locks.
 *
 * Mixed accounts go through the model as well as the rules, which is the whole
 * point of the button: after editing a rule or flipping an account's mode, the
 * stored verdicts should be as trustworthy as a fresh sync's.
 */
export async function reclassifyAll(): Promise<{ updated: number }> {
  const serviceRole = createSupabaseServiceRoleClient();
  const rules = await loadClassificationRules();

  const { data: accountRows } = await serviceRole
    .from("ugc_creator_accounts")
    .select("*, creator:ugc_creators!inner(id, promo_codes, status)");

  const accountsById = new Map(
    ((accountRows ?? []) as unknown as AccountWithCreator[]).map((account) => [
      account.id,
      account,
    ]),
  );

  const { data: videoRows } = await serviceRole
    .from("ugc_videos")
    .select("*")
    .eq("classification_locked", false);

  const videos = (videoRows ?? []) as UgcVideoRow[];
  const resolved = new Map<string, ClassificationResult>();
  const aiCandidates: AiClassificationInput[] = [];

  for (const video of videos) {
    const account = accountsById.get(video.account_id);

    if (!account) {
      continue;
    }

    const promoCodes = account.creator?.promo_codes ?? [];
    const result = classifyVideo(
      {
        caption: video.caption,
        hashtags: video.hashtags,
        mentions: video.mentions,
        contentMode: account.content_mode,
        promoCodes,
      },
      rules,
    );

    resolved.set(video.id, result);

    if (account.content_mode === "mixed") {
      aiCandidates.push({
        id: video.id,
        caption: video.caption,
        hashtags: video.hashtags,
        mentions: video.mentions,
        creatorName: account.handle,
        promoCodes,
        ruleVerdict: result,
      });
    }
  }

  if (aiCandidates.length > 0 && isAiClassificationConfigured()) {
    const verdicts = await classifyWithAi(aiCandidates);

    for (const [videoId, verdict] of verdicts) {
      const ruleVerdict = resolved.get(videoId);

      if (ruleVerdict) {
        resolved.set(videoId, toClassificationResult(verdict, ruleVerdict));
      }
    }
  }

  let updated = 0;

  for (const video of videos) {
    const result = resolved.get(video.id);

    if (
      !result ||
      (result.classification === video.classification &&
        result.source === video.classification_source)
    ) {
      continue;
    }

    await updateIn(serviceRole, "ugc_videos", {
      classification: result.classification,
      classification_source: result.source,
      classification_confidence: result.confidence,
      classification_reason: result.reason,
      classified_at: new Date().toISOString(),
    }).eq("id", video.id);

    updated += 1;
  }

  return { updated };
}

export type { CollectedVideo, CollectedBatch };
