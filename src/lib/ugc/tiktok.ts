/**
 * TikTok URL and profile helpers.
 *
 * Creator links are usually pasted straight out of the TikTok share sheet, so
 * they arrive with tracking parameters (`?_r=1&_t=...`) and sometimes as a
 * short `vm.tiktok.com` redirect. Everything here reduces those to a bare
 * handle we can store and match on.
 */

export type ParsedTikTokProfile = {
  handle: string;
  profileUrl: string;
};

const HANDLE_PATTERN = /^[A-Za-z0-9._]{1,24}$/;

export function normalizeHandle(value: string): string | null {
  const trimmed = value.trim().replace(/^@+/, "");

  if (!trimmed || !HANDLE_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function tiktokProfileUrl(handle: string): string {
  return `https://www.tiktok.com/@${handle}`;
}

/**
 * Accepts a full TikTok profile URL, a video URL, `@handle`, or a bare handle.
 * Returns null for anything else, including short links, which have to be
 * resolved over the network first (see `resolveShortLink`).
 */
export function parseTikTokProfile(input: string): ParsedTikTokProfile | null {
  const value = input.trim();

  if (!value) {
    return null;
  }

  if (!/^https?:\/\//i.test(value)) {
    const handle = normalizeHandle(value);
    return handle ? { handle, profileUrl: tiktokProfileUrl(handle) } : null;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) {
    return null;
  }

  const segment = url.pathname.split("/").filter(Boolean)[0] ?? "";

  if (!segment.startsWith("@")) {
    return null;
  }

  const handle = normalizeHandle(segment);

  return handle ? { handle, profileUrl: tiktokProfileUrl(handle) } : null;
}

export function isTikTokShortLink(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return /^(vm|vt)\.tiktok\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/** Follows a `vm.tiktok.com` short link to the profile it points at. */
export async function resolveShortLink(
  input: string,
  options?: { signal?: AbortSignal },
): Promise<ParsedTikTokProfile | null> {
  try {
    const response = await fetch(input.trim(), {
      redirect: "follow",
      signal: options?.signal,
      headers: {
        // TikTok returns a bare redirect stub to non-browser clients.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    });

    return parseTikTokProfile(response.url);
  } catch {
    return null;
  }
}

export function tiktokVideoUrl(handle: string, videoId: string): string {
  return `https://www.tiktok.com/@${handle}/video/${videoId}`;
}

export type TikTokProfileSnapshot = {
  handle: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  accountId: string | null;
  secUid: string | null;
  followerCount: number | null;
  followingCount: number | null;
  totalLikes: number | null;
  videoCount: number | null;
};

// `[\s\S]` rather than the `s` (dotAll) flag: this project's TypeScript target
// predates it, and the payload spans many lines.
const REHYDRATION_PATTERN =
  /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/;

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reads the account-level counters TikTok embeds in the public profile page.
 *
 * This is free and needs no API key, but it only yields follower/like/video
 * totals — the per-video list is not in the page and needs the Apify collector.
 * It is best effort: TikTok serves a challenge page to some datacenter IPs, in
 * which case this returns null and the caller keeps the previous snapshot.
 */
export async function fetchTikTokProfileSnapshot(
  handle: string,
  options?: { signal?: AbortSignal },
): Promise<TikTokProfileSnapshot | null> {
  try {
    const response = await fetch(tiktokProfileUrl(handle), {
      signal: options?.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const match = REHYDRATION_PATTERN.exec(html);

    if (!match) {
      return null;
    }

    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    const scope = parsed["__DEFAULT_SCOPE__"] as Record<string, unknown> | undefined;
    const detail = scope?.["webapp.user-detail"] as Record<string, unknown> | undefined;
    const userInfo = detail?.["userInfo"] as Record<string, unknown> | undefined;

    if (!userInfo) {
      return null;
    }

    const user = (userInfo["user"] ?? {}) as Record<string, unknown>;
    const stats = (userInfo["stats"] ?? {}) as Record<string, unknown>;

    return {
      handle,
      displayName: typeof user["nickname"] === "string" ? user["nickname"] : null,
      bio: typeof user["signature"] === "string" ? user["signature"] : null,
      avatarUrl: typeof user["avatarMedium"] === "string" ? user["avatarMedium"] : null,
      accountId: typeof user["id"] === "string" ? user["id"] : null,
      secUid: typeof user["secUid"] === "string" ? user["secUid"] : null,
      followerCount: toNumber(stats["followerCount"]),
      followingCount: toNumber(stats["followingCount"]),
      totalLikes: toNumber(stats["heartCount"] ?? stats["heart"]),
      videoCount: toNumber(stats["videoCount"]),
    };
  } catch {
    return null;
  }
}
