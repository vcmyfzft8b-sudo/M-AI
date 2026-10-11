import "server-only";

import { unstable_cache } from "next/cache";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Real Memo AI videos from the campaign's creators, for the examples on `/ugc`.
 *
 * Mostly picked from what the admin dashboard already tracks, plus the posts of the
 * profiles in `SHOWCASE_PROFILES`. From the dashboard: TikTok posts classified as Memo
 * AI, from creator accounts (not our own), most viewed first, at most two per creator so
 * the grid shows different people. The stored covers are TikTok CDN links that expire,
 * so each thumbnail is fetched fresh from TikTok's oEmbed and the whole list is cached
 * for six hours. Anything that fails is left out; no videos means the page shows none.
 */

export type ShowcaseVideo = {
  id: string;
  url: string;
  thumbnail: string;
  views: number;
};

const SHOWCASE_SIZE = 20;
const PER_CREATOR = 3;

/**
 * TikTok profiles whose Memo AI posts join the showcase even though the dashboard does
 * not track them. Their recent posts come from TikTok's public creator embed
 * (`/embed/@handle`), which lists a profile's latest videos with their captions; only
 * posts whose caption mentions Memo are taken.
 */
export const SHOWCASE_PROFILES = ["school.hacks.byklara"];

const PROFILE_POSTS = 8;

type VideoRow = {
  platform_video_id: string;
  url: string;
  views: number;
  creator_id: string;
  creator: { kind: string; status: string } | null;
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

/** Video ids and captions anywhere in the creator embed's state, in the order TikTok lists them. */
function postsInEmbedState(state: unknown): Array<{ id: string; desc: string }> {
  const posts: Array<{ id: string; desc: string }> = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;

      if (typeof record.id === "string" && /^\d{15,25}$/.test(record.id) && typeof record.desc === "string") {
        posts.push({ id: record.id, desc: record.desc });
      }

      Object.values(record).forEach(visit);
    }
  };

  visit(state);
  return posts;
}

/** A profile's latest Memo AI posts, read from TikTok's creator embed. Empty when that fails. */
async function profilePosts(handle: string): Promise<Array<{ id: string; url: string }>> {
  try {
    const response = await fetch(`https://www.tiktok.com/embed/@${encodeURIComponent(handle)}`, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const match = html.match(/<script[^>]*id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/);

    if (!match) {
      return [];
    }

    const seen = new Set<string>();

    return postsInEmbedState(JSON.parse(match[1]))
      .filter((post) => /memo/i.test(post.desc) && !seen.has(post.id) && seen.add(post.id))
      .slice(0, PROFILE_POSTS)
      .map((post) => ({ id: post.id, url: `https://www.tiktok.com/@${handle}/video/${post.id}` }));
  } catch {
    return [];
  }
}

async function loadShowcaseVideos(): Promise<ShowcaseVideo[]> {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("ugc_videos")
    .select("platform_video_id, url, views, creator_id, creator:ugc_creators!inner(kind, status)")
    .eq("classification", "memo")
    .eq("platform", "tiktok")
    .eq("creator.kind", "creator")
    .neq("creator.status", "archived")
    .order("views", { ascending: false })
    .limit(120);

  if (error) {
    throw new Error(`Showcase videos could not be read: ${error.message}`);
  }

  const perCreator = new Map<string, number>();
  const picked = ((data ?? []) as unknown as VideoRow[]).filter((row) => {
    const count = perCreator.get(row.creator_id) ?? 0;

    if (count >= PER_CREATOR || !/^\d+$/.test(row.platform_video_id)) {
      return false;
    }

    perCreator.set(row.creator_id, count + 1);
    return true;
  });

  const fromDashboard = picked.map((row) => ({ id: row.platform_video_id, url: row.url, views: row.views }));
  const fromProfiles = (await Promise.all(SHOWCASE_PROFILES.map(profilePosts))).flat().map((post) => ({ ...post, views: 0 }));

  // Interleaved, so the extra profiles are spread through the wall rather than bunched.
  const merged: Array<{ id: string; url: string; views: number }> = [];
  const seen = new Set<string>();

  for (let index = 0; index < Math.max(fromDashboard.length, fromProfiles.length); index += 1) {
    for (const candidate of [fromDashboard[index], fromProfiles[index]]) {
      if (candidate && !seen.has(candidate.id)) {
        seen.add(candidate.id);
        merged.push(candidate);
      }
    }
  }

  const videos = await mapPooled(merged.slice(0, SHOWCASE_SIZE + 4), 3, async (candidate) => {
    const thumbnail = await thumbnailFor(candidate.url);

    return thumbnail ? { ...candidate, thumbnail } : null;
  });

  const found = videos.filter((video): video is ShowcaseVideo => video !== null).slice(0, SHOWCASE_SIZE);

  // Thrown rather than returned, so a TikTok hiccup (an empty embed, a burst of 503s) is
  // not cached for six hours: the next visitor simply tries again.
  if (found.length === 0) {
    throw new Error("No showcase video could be loaded");
  }

  return found;
}

const cachedShowcaseVideos = unstable_cache(loadShowcaseVideos, ["ugc-creator-showcase-v5"], {
  revalidate: 6 * 60 * 60,
});

export async function getShowcaseVideos(): Promise<ShowcaseVideo[]> {
  return cachedShowcaseVideos().catch(() => []);
}
