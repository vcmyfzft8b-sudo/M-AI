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
  self.skipWaiting();
});

/*
 * The page tells the worker what it just loaded.
 *
 * Caching only on `fetch` looks sufficient and is not: a worker does not
 * control the page that registers it, so the very launch that installs it
 * fetches every asset around it and stores none. The next launch then opens a
 * cache that is still empty and flashes exactly as before — which is what the
 * first cut of this did, measured.
 *
 * So after load the page reads back the build files it actually used and sends
 * them here. No build-time manifest to generate, and no guessing: the list is
 * whatever this page needed, on this deploy.
 */
self.addEventListener("message", (event) => {
  const urls = event.data && event.data.type === "cache-build" ? event.data.urls : null;

  if (!Array.isArray(urls)) {
    return;
  }

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        urls
          .filter((url) => {
            try {
              return isCacheable(new URL(url));
            } catch {
              return false;
            }
          })
          // One bad entry must not abandon the rest, which `cache.addAll` would.
          .map((url) => cache.add(url).catch(() => {})),
      );
    })(),
  );
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
