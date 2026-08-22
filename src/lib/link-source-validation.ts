import { parseYoutubeVideoId } from "./youtube-url.ts";

export const UNSUPPORTED_VIDEO_LINK_MESSAGE =
  "Ta povezava izgleda kot video. MemoAI podpira YouTube videe s podnapisi ter besedilne strani (članke, bloge, spletne strani). Za druge video platforme prilepi povezavo do besedilne strani ali YouTube videa.";

const DIRECT_VIDEO_FILE_EXTENSIONS = [
  ".3g2",
  ".3gp",
  ".avi",
  ".m3u8",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".ogv",
  ".webm",
];

const VIDEO_CONTENT_TYPES = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "video/",
];

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function hostMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function pathStartsWithSegment(pathname: string, segment: string) {
  return pathname === segment || pathname.startsWith(`${segment}/`);
}

function hasDirectVideoFileExtension(pathname: string) {
  const normalizedPathname = pathname.toLowerCase().replace(/\/+$/, "");

  return DIRECT_VIDEO_FILE_EXTENSIONS.some((extension) =>
    normalizedPathname.endsWith(extension),
  );
}

function isYoutubeVideoUrl(url: URL, hostname: string) {
  if (hostMatches(hostname, "youtu.be")) {
    return url.pathname.replace(/\/+$/, "").length > 0;
  }

  if (!hostMatches(hostname, "youtube.com") && !hostMatches(hostname, "youtube-nocookie.com")) {
    return false;
  }

  const pathname = url.pathname.toLowerCase().replace(/\/+$/, "");
  const videoPathPrefixes = ["/clip", "/embed", "/live", "/shorts", "/v"];

  return (
    pathname === "/watch" ||
    pathname === "/playlist" ||
    videoPathPrefixes.some((prefix) => pathStartsWithSegment(pathname, prefix))
  );
}

function isKnownVideoPlatformUrl(url: URL, hostname: string) {
  const pathname = url.pathname.toLowerCase().replace(/\/+$/, "");

  // A YouTube video with a parseable id is now ingested via its captions; only the shapes with
  // no single transcript (playlists, channels, clips) stay unsupported.
  if (parseYoutubeVideoId(url.toString())) {
    return false;
  }

  if (isYoutubeVideoUrl(url, hostname)) {
    return true;
  }

  if (hostMatches(hostname, "vimeo.com")) {
    return pathname.length > 0;
  }

  if (hostMatches(hostname, "dailymotion.com") || hostMatches(hostname, "dai.ly")) {
    return pathname.length > 0;
  }

  if (hostMatches(hostname, "tiktok.com")) {
    return (
      hostname === "vm.tiktok.com" ||
      hostname === "vt.tiktok.com" ||
      pathname.includes("/video/")
    );
  }

  if (hostname === "clips.twitch.tv" || hostMatches(hostname, "twitch.tv")) {
    return (
      hostname === "clips.twitch.tv" ||
      pathStartsWithSegment(pathname, "/videos") ||
      pathStartsWithSegment(pathname, "/clip")
    );
  }

  if (hostMatches(hostname, "instagram.com")) {
    return pathStartsWithSegment(pathname, "/reel") || pathStartsWithSegment(pathname, "/tv");
  }

  if (hostname === "fb.watch" || hostMatches(hostname, "facebook.com")) {
    return (
      hostname === "fb.watch" ||
      pathStartsWithSegment(pathname, "/watch") ||
      pathStartsWithSegment(pathname, "/reel") ||
      pathStartsWithSegment(pathname, "/videos")
    );
  }

  return false;
}

export function isUnsupportedVideoUrl(value: string) {
  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    const hostname = normalizeHostname(url.hostname);

    return (
      hasDirectVideoFileExtension(url.pathname) ||
      isKnownVideoPlatformUrl(url, hostname)
    );
  } catch {
    return false;
  }
}

export function isUnsupportedVideoContentType(contentType: string) {
  const normalizedContentType = contentType.toLowerCase();

  return VIDEO_CONTENT_TYPES.some((videoContentType) =>
    normalizedContentType.includes(videoContentType),
  );
}

export function getUnsupportedVideoUrlMessage(value: string) {
  return isUnsupportedVideoUrl(value) ? UNSUPPORTED_VIDEO_LINK_MESSAGE : null;
}
