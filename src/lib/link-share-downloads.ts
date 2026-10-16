// A SharePoint or OneDrive "anyone with the link" share opens the document in Word,
// PowerPoint or the PDF viewer online: a script shell with no readable text. The same link with
// `download=1` serves the file itself, which we can read like any uploaded document.
//
// Either way the share only answers a client that keeps its cookie. The first response sets a
// guest session (FedAuth) and redirects to the document on the same host; without the cookie
// that second request is sent to the tenant's sign-in page instead.

// The share link's first path segment names the kind of item: w(ord), p(owerpoint), b (PDF).
// Personal OneDrive serves the same shares from onedrive.live.com, and its 1drv.ms short links
// name the kind without the colons (`1drv.ms/p/c/...`).
const DOWNLOADABLE_SHARE_KINDS = new Set([":w:", ":p:", ":b:"]);
const DOWNLOADABLE_SHORT_SHARE_KINDS = new Set(["w", "p", "b"]);

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

function isSharePointHost(hostname: string) {
  const normalized = normalizeHostname(hostname);

  return (
    normalized === "sharepoint.com" ||
    normalized.endsWith(".sharepoint.com") ||
    normalized === "onedrive.live.com"
  );
}

function isShareKind(url: URL, kind: string) {
  return normalizeHostname(url.hostname) === "1drv.ms"
    ? DOWNLOADABLE_SHORT_SHARE_KINDS.has(kind)
    : isSharePointHost(url.hostname) && DOWNLOADABLE_SHARE_KINDS.has(kind);
}

/**
 * The URL that downloads the document a SharePoint share link opens online, or null when the
 * link is not a share of a document we read.
 */
export function shareLinkDownloadUrl(url: URL): URL | null {
  const kind = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";

  if (!isShareKind(url, kind) || url.searchParams.get("download") === "1") {
    return null;
  }

  const downloadUrl = new URL(url);
  downloadUrl.searchParams.set("download", "1");

  return downloadUrl;
}

/** `existing` with the pairs of `added` on top, a later value replacing an earlier one by name. */
export function mergeCookieHeaders(existing: string, added: string) {
  const pairs = new Map<string, string>();

  for (const pair of `${existing};${added}`.split(";")) {
    const trimmed = pair.trim();
    const separator = trimmed.indexOf("=");

    if (separator > 0) {
      pairs.set(trimmed.slice(0, separator), trimmed);
    }
  }

  return [...pairs.values()].join("; ");
}
