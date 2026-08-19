import "server-only";

/**
 * Apify collector for TikTok creator posts.
 *
 * TikTok does not expose per-video metrics to an unauthenticated server: the
 * public profile page carries account totals only, and `/api/post/item_list/`
 * needs signed request parameters. Apify runs a real browser session for us and
 * returns playCount/digg/comment/share per post.
 *
 * Runs are started asynchronously and polled, rather than using Apify's
 * `run-sync` endpoint. Fourteen profiles comfortably exceed the 300s serverless
 * budget, and a synchronous call that times out leaves us with no run id and no
 * way to recover the data we already paid for.
 */

export const APIFY_TIKTOK_ACTOR = "clockworks~tiktok-scraper";

const APIFY_BASE_URL = "https://api.apify.com/v2";

export type ApifyRunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "ABORTING"
  | "ABORTED"
  | "TIMING-OUT"
  | "TIMED-OUT";

export type ApifyRun = {
  id: string;
  status: ApifyRunStatus;
  defaultDatasetId: string;
  startedAt: string | null;
  finishedAt: string | null;
  statusMessage: string | null;
};

export type CollectedVideo = {
  platformVideoId: string;
  handle: string;
  url: string;
  caption: string | null;
  hashtags: string[];
  mentions: string[];
  coverUrl: string | null;
  durationSeconds: number | null;
  postedAt: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  isPinned: boolean;
  isAd: boolean;
};

export type CollectedAccount = {
  handle: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  accountId: string | null;
  followerCount: number | null;
  followingCount: number | null;
  totalLikes: number | null;
  videoCount: number | null;
};

export type CollectedBatch = {
  videos: CollectedVideo[];
  accounts: CollectedAccount[];
};

export class ApifyError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApifyError";
    this.status = status;
  }
}

export function getApifyToken(): string | null {
  const token = process.env.APIFY_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

export function requireApifyToken(): string {
  const token = getApifyToken();

  if (!token) {
    throw new ApifyError(
      "APIFY_TOKEN is not configured, so TikTok stats cannot be collected automatically.",
    );
  }

  return token;
}

export function isApifyConfigured(): boolean {
  return getApifyToken() !== null;
}

async function apifyFetch(
  path: string,
  init: RequestInit & { token: string },
): Promise<unknown> {
  const { token, ...rest } = init;
  const url = new URL(`${APIFY_BASE_URL}${path}`);
  url.searchParams.set("token", token);

  const response = await fetch(url, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(rest.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ApifyError(
      `Apify request failed (${response.status}): ${body.slice(0, 400)}`,
      response.status,
    );
  }

  return response.json();
}

function readRun(payload: unknown): ApifyRun {
  const data = (payload as { data?: Record<string, unknown> })?.data ?? {};

  return {
    id: String(data["id"] ?? ""),
    status: (data["status"] as ApifyRunStatus) ?? "READY",
    defaultDatasetId: String(data["defaultDatasetId"] ?? ""),
    startedAt: typeof data["startedAt"] === "string" ? data["startedAt"] : null,
    finishedAt: typeof data["finishedAt"] === "string" ? data["finishedAt"] : null,
    statusMessage:
      typeof data["statusMessage"] === "string" ? data["statusMessage"] : null,
  };
}

/**
 * Queues a scrape of the given handles. `maxPerProfile` bounds cost: every
 * returned post is a billable Apify result, and the campaign only needs recent
 * posts because older ones are already in our own history.
 */
export async function startTikTokRun(options: {
  handles: string[];
  maxPerProfile?: number;
}): Promise<ApifyRun> {
  const token = requireApifyToken();
  const handles = Array.from(new Set(options.handles.filter(Boolean)));

  if (handles.length === 0) {
    throw new ApifyError("No TikTok handles to sync.");
  }

  const payload = await apifyFetch(`/acts/${APIFY_TIKTOK_ACTOR}/runs`, {
    token,
    method: "POST",
    body: JSON.stringify({
      profiles: handles,
      resultsPerPage: options.maxPerProfile ?? 30,
      profileScrapeSections: ["videos"],
      profileSorting: "latest",
      excludePinnedPosts: false,
      // Media downloads multiply both runtime and storage cost, and the
      // dashboard only ever renders the remote cover URL.
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadAvatars: false,
      shouldDownloadSubtitles: false,
      shouldDownloadSlideshowImages: false,
    }),
  });

  return readRun(payload);
}

export async function getRun(runId: string): Promise<ApifyRun> {
  const token = requireApifyToken();
  return readRun(await apifyFetch(`/actor-runs/${runId}`, { token, method: "GET" }));
}

export async function abortRun(runId: string): Promise<void> {
  const token = requireApifyToken();
  await apifyFetch(`/actor-runs/${runId}/abort`, { token, method: "POST" }).catch(
    () => undefined,
  );
}

export function isRunFinished(status: ApifyRunStatus): boolean {
  return !["READY", "RUNNING", "ABORTING", "TIMING-OUT"].includes(status);
}

function toInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
}

function toOptionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Normalises one Apify dataset item into our own shape. */
function readVideo(item: Record<string, unknown>): CollectedVideo | null {
  const platformVideoId = readString(item["id"]);
  const author = (item["authorMeta"] ?? {}) as Record<string, unknown>;
  const handle = readString(author["name"]) ?? readString(item["input"]);

  if (!platformVideoId || !handle) {
    return null;
  }

  const videoMeta = (item["videoMeta"] ?? {}) as Record<string, unknown>;

  // Apify emits hashtags as `[{name: "school"}]` and sometimes includes an
  // empty-name entry for the trailing "#" in a caption.
  const hashtags = Array.isArray(item["hashtags"])
    ? (item["hashtags"] as Array<Record<string, unknown>>)
        .map((tag) => readString(tag?.["name"]))
        .filter((tag): tag is string => Boolean(tag))
        .map((tag) => tag.toLowerCase())
    : [];

  // `detailedMentions` carries the real handle; the plain `mentions` array only
  // has the display name TikTok renders ("@Memo AI"). Keep both, because the
  // classifier normalises either into the same token.
  const detailed = Array.isArray(item["detailedMentions"])
    ? (item["detailedMentions"] as Array<Record<string, unknown>>)
        .map((mention) => readString(mention?.["name"]))
        .filter((mention): mention is string => Boolean(mention))
    : [];
  const plain = Array.isArray(item["mentions"])
    ? (item["mentions"] as unknown[])
        .map((mention) => readString(mention))
        .filter((mention): mention is string => Boolean(mention))
    : [];

  const createTimeIso = readString(item["createTimeISO"]);
  const createTime = toOptionalInteger(item["createTime"]);

  return {
    platformVideoId,
    handle: handle.replace(/^@/, ""),
    url:
      readString(item["webVideoUrl"]) ??
      `https://www.tiktok.com/@${handle}/video/${platformVideoId}`,
    caption: readString(item["text"]),
    hashtags: Array.from(new Set(hashtags)),
    mentions: Array.from(
      new Set([...detailed, ...plain].map((mention) => mention.toLowerCase())),
    ),
    coverUrl: readString(videoMeta["coverUrl"]),
    durationSeconds: toOptionalInteger(videoMeta["duration"]),
    postedAt:
      createTimeIso ??
      (createTime ? new Date(createTime * 1000).toISOString() : null),
    views: toInteger(item["playCount"]),
    likes: toInteger(item["diggCount"]),
    comments: toInteger(item["commentCount"]),
    shares: toInteger(item["shareCount"]),
    saves: toInteger(item["collectCount"]),
    isPinned: item["isPinned"] === true,
    isAd: item["isAd"] === true,
  };
}

function readAccount(item: Record<string, unknown>): CollectedAccount | null {
  const author = (item["authorMeta"] ?? {}) as Record<string, unknown>;
  const handle = readString(author["name"]);

  if (!handle) {
    return null;
  }

  return {
    handle: handle.replace(/^@/, ""),
    displayName: readString(author["nickName"]),
    bio: readString(author["signature"]),
    avatarUrl: readString(author["avatar"]),
    accountId: readString(author["id"]),
    followerCount: toOptionalInteger(author["fans"]),
    followingCount: toOptionalInteger(author["following"]),
    totalLikes: toOptionalInteger(author["heart"]),
    videoCount: toOptionalInteger(author["video"]),
  };
}

/** Reads every item from a finished run's dataset, paging until exhausted. */
export async function readRunDataset(datasetId: string): Promise<CollectedBatch> {
  const token = requireApifyToken();
  const videos: CollectedVideo[] = [];
  const accounts = new Map<string, CollectedAccount>();

  const pageSize = 500;
  let offset = 0;

  // Bounded so a runaway dataset cannot spin here forever.
  for (let page = 0; page < 40; page += 1) {
    const items = (await apifyFetch(
      `/datasets/${datasetId}/items?clean=true&format=json&limit=${pageSize}&offset=${offset}`,
      { token, method: "GET" },
    )) as unknown;

    if (!Array.isArray(items) || items.length === 0) {
      break;
    }

    for (const raw of items as Array<Record<string, unknown>>) {
      // Apify reports a profile that could not be scraped as an error item
      // rather than failing the run.
      if (raw["error"]) {
        continue;
      }

      const video = readVideo(raw);

      if (video) {
        videos.push(video);
      }

      const account = readAccount(raw);

      if (account && !accounts.has(account.handle.toLowerCase())) {
        accounts.set(account.handle.toLowerCase(), account);
      }
    }

    if (items.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return { videos, accounts: Array.from(accounts.values()) };
}
