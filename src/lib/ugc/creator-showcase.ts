import "server-only";

import { unstable_cache } from "next/cache";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Real Memo AI videos from the campaign's creators, for the examples on `/ugc`.
 *
 * The pool is every creator's Memo AI posts the admin dashboard has classified (TikTok,
 * creator accounts), plus the recent Memo AI posts of every profile in
 * `SHOWCASE_PROFILES` and every dashboard account (so new posts show before the
 * dashboard has classified them, and previews, whose staging database tracks nothing,
 * still show the whole campaign).
 * Covers come from each profile's public TikTok embed, which lists its latest posts with
 * a fresh cover and play count; older posts fall back to TikTok's oEmbed. TikTok's cover
 * links expire after a few days, so the pool is cached for six hours, and the page
 * shuffles it on every visit (`shuffleShowcase`) so no two visits show the same wall.
 * From each creator only their few most viewed videos are taken.
 */

export type ShowcaseVideo = {
  id: string;
  url: string;
  thumbnail: string;
  views: number;
};

/** How many videos the cached pool holds; the page shows a random mix of them. */
const POOL_SIZE = 60;
/** Each creator's most viewed videos, this many at most: different people, all doing well. */
const PER_CREATOR = 4;
/** Below this a video is not shown, except as a creator's single best one. */
const MIN_VIEWS = 3_000;
/** oEmbed calls per refresh for posts the embeds no longer list. TikTok 503s on bursts. */
const OEMBED_BUDGET = 60;

/**
 * The campaign's TikTok profiles, read through TikTok's public creator embed
 * (`/embed/@handle`, a profile's latest posts with captions). `dedicated` accounts post
 * only about Memo AI, so all their posts count; from a `mixed` account only posts whose
 * caption mentions Memo (or that the dashboard classified as Memo). Taken from the
 * dashboard's creator accounts on 2026-10-11, plus school.hacks.byklara, which it does
 * not track; dashboard accounts added later are read automatically.
 */
export const SHOWCASE_PROFILES: Record<string, "dedicated" | "mixed"> = {
  "school.hacks.byklara": "dedicated",
  spelcaa41: "dedicated",
  rubissiti: "dedicated",
  memo_ai_sii: "dedicated",
  lara_memoai: "dedicated",
  neligomolj2: "dedicated",
  "mm.memoai": "dedicated",
  mt_memoai: "dedicated",
  studywithpija: "mixed",
  eemadilema: "mixed",
  limkaema: "mixed",
  emakozelj5: "mixed",
  mavija94: "mixed",
  "zoja.vajda": "mixed",
  studiesbytara: "mixed",
  ma_anamana: "mixed",
  "jz.daily": "mixed",
  dejnehino: "mixed",
  neli_gomolj: "mixed",
};

type VideoRow = {
  platform_video_id: string;
  url: string;
  views: number;
  creator_id: string;
  account: { handle: string; content_mode: string } | null;
};

async function fetchThumbnail(url: string): Promise<string | null> {
  try {
    const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(4_000),
    });

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as { thumbnail_url?: unknown };

    return typeof body.thumbnail_url === "string" && body.thumbnail_url.startsWith("https://") ? body.thumbnail_url : null;
  } catch {
    return null;
  }
}

/** TikTok answers a burst of oEmbed calls with 503s, so a miss gets one more try. */
async function thumbnailFor(url: string): Promise<string | null> {
  return (await fetchThumbnail(url)) ?? (await new Promise((resolve) => setTimeout(resolve, 400)).then(() => fetchThumbnail(url)));
}

/** Runs `task` over `items` a few at a time, keeping their order. */
async function mapPooled<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await task(items[index]);
      }
    }),
  );

  return results;
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

type EmbedPost = { id: string; desc: string; cover: string | null; plays: number };

/** Every post anywhere in the creator embed's state, in the order TikTok lists them. */
function postsInEmbedState(state: unknown): EmbedPost[] {
  const posts: EmbedPost[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;

      if (typeof record.id === "string" && /^\d{15,25}$/.test(record.id) && typeof record.desc === "string") {
        const cover = [record.originCoverUrl, record.coverUrl].find(
          (value): value is string => typeof value === "string" && value.startsWith("https://"),
        );

        posts.push({
          id: record.id,
          desc: record.desc,
          cover: cover ?? null,
          plays: typeof record.playCount === "number" ? record.playCount : 0,
        });
      }

      Object.values(record).forEach(visit);
    }
  };

  visit(state);
  return posts;
}

async function fetchEmbedPosts(handle: string): Promise<EmbedPost[] | null> {
  try {
    const response = await fetch(`https://www.tiktok.com/embed/@${encodeURIComponent(handle)}`, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      // 503 is TikTok shedding a burst and worth another try; 400 is a profile that
      // does not allow embedding, and stays that way.
      return response.status >= 500 ? null : [];
    }

    const match = (await response.text()).match(/<script[^>]*id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/);

    return match ? postsInEmbedState(JSON.parse(match[1])) : [];
  } catch {
    return null;
  }
}

/** A profile's latest posts from TikTok's creator embed. Empty when that fails. */
async function profilePosts(handle: string): Promise<EmbedPost[]> {
  const posts =
    (await fetchEmbedPosts(handle)) ??
    (await new Promise((resolve) => setTimeout(resolve, 500)).then(() => fetchEmbedPosts(handle))) ??
    [];
  const seen = new Set<string>();

  return posts.filter((post) => !seen.has(post.id) && seen.add(post.id));
}

type Candidate = { id: string; url: string; views: number; handle: string; cover: string | null };

async function loadShowcaseVideos(): Promise<ShowcaseVideo[]> {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("ugc_videos")
    .select("platform_video_id, url, views, creator_id, account:ugc_creator_accounts(handle, content_mode), creator:ugc_creators!inner(kind, status)")
    .eq("classification", "memo")
    .eq("platform", "tiktok")
    .eq("creator.kind", "creator")
    .neq("creator.status", "archived")
    .order("views", { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(`Showcase videos could not be read: ${error.message}`);
  }

  const rows = ((data ?? []) as unknown as VideoRow[]).filter((row) => /^\d+$/.test(row.platform_video_id));
  const trackedIds = new Set(rows.map((row) => row.platform_video_id));
  const modes = new Map<string, string>(Object.entries(SHOWCASE_PROFILES));

  for (const row of rows) {
    if (row.account?.handle && !modes.has(row.account.handle)) {
      modes.set(row.account.handle, row.account.content_mode);
    }
  }

  const embeds = new Map<string, EmbedPost>();
  const extras: Candidate[] = [];

  await mapPooled([...modes.keys()], 4, async (handle) => {
    const posts = await profilePosts(handle);
    const dedicated = modes.get(handle) === "dedicated";

    for (const post of posts) {
      embeds.set(post.id, post);

      // Posts the dashboard has not classified (yet): a dedicated account's, or ones that say Memo.
      if (!trackedIds.has(post.id) && (dedicated || /memo/i.test(post.desc))) {
        extras.push({
          id: post.id,
          url: `https://www.tiktok.com/@${handle}/video/${post.id}`,
          views: post.plays,
          handle,
          cover: post.cover,
        });
      }
    }
  });

  const tracked: Candidate[] = rows.map((row) => {
    const embed = embeds.get(row.platform_video_id);

    return {
      id: row.platform_video_id,
      url: row.url,
      views: Math.max(row.views, embed?.plays ?? 0),
      handle: row.account?.handle ?? row.creator_id,
      cover: embed?.cover ?? null,
    };
  });

  const byCreator = new Map<string, Candidate[]>();
  const seen = new Set<string>();

  for (const candidate of [...tracked, ...extras]) {
    if (seen.has(candidate.id)) {
      continue;
    }

    seen.add(candidate.id);
    byCreator.set(candidate.handle, [...(byCreator.get(candidate.handle) ?? []), candidate]);
  }

  // Per creator: their most viewed, those under MIN_VIEWS only as the creator's one best.
  const lists = [...byCreator.values()].map((list) =>
    list
      .sort((a, b) => b.views - a.views)
      .filter((candidate, index) => index === 0 || candidate.views >= MIN_VIEWS)
      .slice(0, PER_CREATOR),
  );

  // Round-robin across creators, so the pool holds as many different people as it can.
  const picked: Candidate[] = [];

  for (let round = 0; round < PER_CREATOR && picked.length < POOL_SIZE; round += 1) {
    for (const list of lists) {
      if (list[round] && picked.length < POOL_SIZE) {
        picked.push(list[round]);
      }
    }
  }

  let oembedCalls = 0;
  const videos = await mapPooled(picked, 3, async (candidate) => {
    if (candidate.cover) {
      return { id: candidate.id, url: candidate.url, views: candidate.views, thumbnail: candidate.cover };
    }

    if (oembedCalls >= OEMBED_BUDGET) {
      return null;
    }

    oembedCalls += 1;
    const thumbnail = await thumbnailFor(candidate.url);

    return thumbnail ? { id: candidate.id, url: candidate.url, views: candidate.views, thumbnail } : null;
  });

  const found = videos.filter((video): video is ShowcaseVideo => video !== null);

  // Thrown rather than returned, so a TikTok hiccup (an empty embed, a burst of 503s) is
  // not cached for six hours: the next visitor simply tries again.
  if (found.length === 0) {
    throw new Error("No showcase video could be loaded");
  }

  return found;
}

const cachedShowcaseVideos = unstable_cache(loadShowcaseVideos, ["ugc-creator-showcase-v8"], {
  revalidate: 6 * 60 * 60,
});

/** The cached pool in a fresh random order: a different wall on every visit. */
export async function getShowcaseVideos(): Promise<ShowcaseVideo[]> {
  return shuffleShowcase(await cachedShowcaseVideos().catch(() => []));
}

/** Fisher-Yates, on a copy. */
export function shuffleShowcase<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }

  return copy;
}
