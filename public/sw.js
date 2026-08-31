/*
 * Why this exists: the white frame between the launch screen and the app.
 *
 * iOS holds its launch image until the page's first paint, and first paint
 * waits on render-blocking CSS. Memo ships ~88 KB gzipped of it across three
 * files, so on a cold start there is a stretch where the document has arrived
 * and painted nothing — and a document that has painted nothing is white. That
 * is the flash. Measured: the same app launched with its assets already cached
 * shows no white frame at all, which is the whole idea here.
 *
 * Scope is deliberately one directory. `/_next/static/` filenames carry a
 * content hash, so a cached copy can never be stale — a changed file is a
 * changed URL. Nothing else is touched: no HTML, no API, no images outside
 * that tree. Caching a page would mean caching one account's notes and handing
 * them to whoever opens the app next, and no launch animation is worth that.
 */

const CACHE = "memo-static-v1";

/** Content-hashed build output, and nothing else. */
function isCacheable(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
}

self.addEventListener("install", () => {
  // Nothing is precached: the point is to keep what the app already fetched,
  // not to predict a file list that changes every deploy.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (!isCacheable(url)) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);

      if (hit) {
        return hit;
      }

      const response = await fetch(request);

      /*
       * `basic` excludes opaque cross-origin replies, which cannot be read and
       * would poison the cache with something unusable. A non-200 is not worth
       * keeping either — a 404 cached forever is a file that never recovers.
       */
      if (response && response.status === 200 && response.type === "basic") {
        cache.put(request, response.clone()).catch(() => {});
      }

      return response;
    })(),
  );
});
