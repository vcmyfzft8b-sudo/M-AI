import "server-only";

import { unstable_cache } from "next/cache";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Real Memo AI videos from the campaign's creators, for the examples on `/ugc`.
 *
 * Picked from what the admin dashboard already tracks: TikTok posts classified as Memo
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

const SHOWCASE_SIZE = 10;
const PER_CREATOR = 2;

type VideoRow = {
  platform_video_id: string;
  url: string;
  views: number;
  creator_id: string;
  creator: { kind: string; status: string } | null;
};

async function thumbnailFor(url: string): Promise<string | null> {
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

async function loadShowcaseVideos(): Promise<ShowcaseVideo[]> {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("ugc_videos")
    .select("platform_video_id, url, views, creator_id, creator:ugc_creators!inner(kind, status)")
    .eq("classification", "memo")
    .eq("platform", "tiktok")
    .eq("creator.kind", "creator")
    .neq("creator.status", "archived")
    .order("views", { ascending: false })
    .limit(60);

  if (error || !data) {
    throw new Error(`Showcase videos could not be read: ${error?.message ?? "no data"}`);
  }

  const perCreator = new Map<string, number>();
  const picked = (data as unknown as VideoRow[]).filter((row) => {
    const count = perCreator.get(row.creator_id) ?? 0;

    if (count >= PER_CREATOR || !/^\d+$/.test(row.platform_video_id)) {
      return false;
    }

    perCreator.set(row.creator_id, count + 1);
    return true;
  });

  const videos = await Promise.all(
    picked.slice(0, SHOWCASE_SIZE + 4).map(async (row) => {
      const thumbnail = await thumbnailFor(row.url);

      return thumbnail ? { id: row.platform_video_id, url: row.url, thumbnail, views: row.views } : null;
    }),
  );

  const found = videos.filter((video): video is ShowcaseVideo => video !== null).slice(0, SHOWCASE_SIZE);

  // Thrown rather than returned, so a TikTok hiccup is not cached for six hours.
  if (found.length === 0 && picked.length > 0) {
    throw new Error("No showcase thumbnail could be fetched from TikTok");
  }

  return found;
}

const cachedShowcaseVideos = unstable_cache(loadShowcaseVideos, ["ugc-creator-showcase-v1"], {
  revalidate: 6 * 60 * 60,
});

export async function getShowcaseVideos(): Promise<ShowcaseVideo[]> {
  return cachedShowcaseVideos().catch(() => []);
}
