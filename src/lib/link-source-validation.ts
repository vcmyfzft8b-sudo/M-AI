import { parseYoutubeVideoId } from "./youtube-url.ts";

/**
 * YouTube answers the innertube handshake with LOGIN_REQUIRED ("Sign in to confirm you're not a
 * bot") for every request from a datacenter IP — measured from Vercel iad1 on 2026-08-23 across
 * every client, with and without visitorData, while the identical calls from a residential IP
 * return OK with caption tracks. So captions are only offered where the deployment reaches YouTube
 * from an egress it will serve — a residential proxy or a transcript service, switched on with
 * NEXT_PUBLIC_YOUTUBE_IMPORT=on. Everywhere else the link is refused here, up front, instead of
 * being accepted and failed halfway through the pipeline with a misleading "check whether the
 * video is public".
 *
 * Read per call rather than cached at module load so the contract is testable in both states.
 */
export function isYoutubeCaptionImportEnabled() {
  return process.env.NEXT_PUBLIC_YOUTUBE_IMPORT?.trim() === "on";
}

/**
 * Promising YouTube support in the rejection text is only honest where captions can actually be
 * fetched; where they cannot, offering it sends the learner back to paste the same link again.
 *
 * Returns the message *key* rather than the sentence, because the caller knows which language the
 * reader is in and this module does not — it runs deep in the pipeline as well as in a request.
 */
export function getUnsupportedVideoLinkMessageKey() {
  return isYoutubeCaptionImportEnabled()
    ? "failure.unsupported_video_link"
    : "failure.unsupported_video_link_no_youtube";
}

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

  // A YouTube video with a parseable id is ingested via its captions wherever an egress YouTube
  // will serve is configured; only the shapes with no single transcript (playlists, channels,
  // clips) stay unsupported there. Without that egress the handshake cannot succeed at all, so
  // the link is refused here rather than accepted and failed mid-pipeline.
  if (isYoutubeCaptionImportEnabled() && parseYoutubeVideoId(url.toString())) {
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

export function getUnsupportedVideoUrlMessageKey(value: string) {
  return isUnsupportedVideoUrl(value) ? getUnsupportedVideoLinkMessageKey() : null;
}

/**
 * Whether a response is worth trying to read as a page.
 *
 * Anything textual qualifies, plus the XML-flavoured HTML that a surprising number of university
 * and government sites still serve, plus JSON — an API or a docs page rendered from JSON still has
 * words in it, and the extractor either finds prose or the pipeline rejects it downstream for
 * having nothing to teach. A learner pasting a link should be told "there is nothing here to
 * learn from" only when that is true, not when the server used an unusual content type. Binary —
 * video, audio, images, archives — is still refused, since there is no text to find.
 */
export function isReadableLinkContentType(contentType: string) {
  const normalized = contentType.toLowerCase();

  return (
    normalized.startsWith("text/") ||
    normalized.includes("application/xhtml") ||
    normalized.includes("application/xml") ||
    normalized.includes("+xml") ||
    normalized.includes("application/json") ||
    normalized.includes("+json") ||
    // A server that says nothing is usually a plain page; read it and judge by the content.
    normalized.trim().length === 0
  );
}
