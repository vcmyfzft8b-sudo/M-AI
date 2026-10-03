// A link to a digital library usually lands on the item's catalogue page, not on the work
// itself: title, author, year and a "PDF" button. The learner wants the work, and when the
// library serves it openly we can fetch it the way their browser would.
//
// dLib.si, the National and University Library's digital library, is the one Slovenian
// students paste most. Its details page links the full text at /stream/<URN>/<id>/PDF, and
// that stream answers only a client that kept the page's ASP.NET session cookie: without it
// the stream redirects straight back to the details page.

const DLIB_HOSTS = ["dlib.si"];

function isDlibHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");

  return DLIB_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

/** True for a page of a repository whose catalogue pages we know how to follow to the work. */
export function isRepositoryCatalogueUrl(url: URL) {
  return isDlibHost(url.hostname);
}

/** The work's title from its catalogue page's `<title>`, without the site's own prefix. */
export function repositoryDocumentTitle(pageTitle: string) {
  return pageTitle.replace(/^dLib\.si\s*[-–]\s*/i, "").trim();
}

/**
 * The open full-text document a repository's catalogue page links to, or null when the page is
 * not one we know or links no document. Only ever a URL on the page's own host.
 */
export function findRepositoryDocumentUrl(pageUrl: URL, html: string): URL | null {
  if (!isDlibHost(pageUrl.hostname) || typeof html !== "string") {
    return null;
  }

  const match = html.match(/href\s*=\s*["']((?:https?:\/\/[^"'/]+)?\/stream\/[^"'\s]+\/PDF)["']/i);

  if (!match) {
    return null;
  }

  let documentUrl: URL;

  try {
    documentUrl = new URL(match[1].replace(/&amp;/gi, "&"), pageUrl);
  } catch {
    return null;
  }

  return documentUrl.hostname === pageUrl.hostname ? documentUrl : null;
}

/**
 * The `name=value` pairs a response asked to be sent back, for the follow-up request to the
 * same host. Attributes (path, expiry, flags) are dropped; the request is made once, at once.
 */
export function sessionCookieHeader(headers: Headers) {
  const setCookies =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];

  return setCookies
    .map((value) => value.split(";")[0]?.trim() ?? "")
    .filter((pair) => /^[^=\s]+=/.test(pair))
    .join("; ");
}
