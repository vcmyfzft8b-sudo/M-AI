// Kept free of "server-only" so URL recognition stays unit-testable
// (tests/youtube-url.test.mjs) outside the Next.js runtime.

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^www\.|^m\.|^music\./, "");
}

/**
 * Extracts the video id from any YouTube video URL shape (watch, youtu.be, shorts, embed, live).
 * Returns null for everything else, including playlists and channels — those have no single
 * transcript to ingest.
 */
export function parseYoutubeVideoId(value: string): string | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  const hostname = normalizeHostname(url.hostname);
  const pathname = url.pathname.replace(/\/+$/, "");

  const candidate = (() => {
    if (hostname === "youtu.be") {
      return pathname.split("/")[1] ?? null;
    }

    if (hostname !== "youtube.com" && hostname !== "youtube-nocookie.com") {
      return null;
    }

    if (pathname === "/watch") {
      return url.searchParams.get("v");
    }

    const segments = pathname.split("/").filter(Boolean);

    if (segments.length === 2 && ["embed", "shorts", "live", "v"].includes(segments[0])) {
      return segments[1];
    }

    return null;
  })();

  return candidate && YOUTUBE_VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
}
