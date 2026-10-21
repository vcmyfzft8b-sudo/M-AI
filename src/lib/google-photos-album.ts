/**
 * A Google Photos shared album ("photos.app.goo.gl/…"), read as the photos in it.
 *
 * The album page renders in the browser: its markup is an app shell with a few words of chrome,
 * so it was read as a web page and failed as "not enough readable text" while the learner had
 * shared photographed notebook pages (note triage, lectures beefbfba, 31cf1f1c and 58680a49). The
 * photos travel in the page's loader data as `["AF1Qip…",["https://lh3.googleusercontent.com/pw/…",
 * width,height,…` entries, in album order, and are served publicly to anyone with the link.
 *
 * Kept free of imports so the parsing is testable on its own.
 */

export type GooglePhotosAlbumPhoto = {
  id: string;
  url: string;
};

/** Where a shared-album link lands once its short link has redirected. */
export function isGooglePhotosAlbumUrl(url: URL) {
  return url.hostname === "photos.google.com" && /^\/(?:u\/\d+\/)?share\/[^/]+\/?$/.test(url.pathname);
}

const ALBUM_PHOTO_PATTERN =
  /\["(AF1Qip[A-Za-z0-9_-]+)",\["(https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]+)",\d+,\d+/g;

/** The album's photos in album order, each once. The owner's avatar and the cover are not entries. */
export function extractGooglePhotosAlbumPhotos(html: string): GooglePhotosAlbumPhoto[] {
  const photos: GooglePhotosAlbumPhoto[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(ALBUM_PHOTO_PATTERN)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      photos.push({ id: match[1], url: match[2] });
    }
  }

  return photos;
}

/**
 * The photo at a size the reader can use. The base URL alone is a small preview; the size suffix
 * asks for up to the edge the photo normaliser keeps anyway, never the original's full resolution.
 */
export function googlePhotosDownloadUrl(photo: GooglePhotosAlbumPhoto) {
  return new URL(`${photo.url}=w3072-h3072`);
}
