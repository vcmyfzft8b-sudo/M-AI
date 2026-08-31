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

/**
 * Roughly several deploys' worth of chunks. High enough that normal use — one
 * build, many screens, each adding its own — never trims; low enough that the
 * cache cannot grow until the browser evicts all of it.
 */
const MAX_ENTRIES = 300;

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
      const wanted = urls.filter((url) => {
        try {
          return isCacheable(new URL(url));
        } catch {
          return false;
        }
      });

      /*
       * Only what is missing. A worker's own `cache.add` does not pass through
       * its fetch handler, so re-adding an entry always leaves the cache to be
       * refetched — and this message arrives on every page load. The files are
       * `immutable`, so those refetches are served by the HTTP cache rather
       * than the network, but the work is still pointless and it is a lot of
       * requests to raise for nothing.
       */
      const missing = (
        await Promise.all(
          wanted.map(async (url) => ((await cache.match(url)) ? null : url)),
        )
      ).filter(Boolean);

      await Promise.all(
        // One bad entry must not abandon the rest, which `cache.addAll` would.
        missing.map((url) => cache.add(url).catch(() => {})),
      );

      /*
       * Hashed filenames mean a deploy never overwrites an entry, it adds one,
       * so left alone this cache only grows — and an origin that runs out of
       * storage gets the whole thing evicted, which is the flash back and
       * worse.
       *
       * Only trim when it is actually oversized, though. Each page sends the
       * chunks *it* used, so dropping everything outside the current list on
       * every message would have the home screen evicting the note screen's
       * assets and back again forever. Past the cap, that same list is the best
       * evidence available of what is still current, and a cache this size is
       * already several deploys of rubbish.
       */
      const entries = await cache.keys();

      if (entries.length > MAX_ENTRIES) {
        const keep = new Set(wanted.map((url) => new URL(url).pathname));

        await Promise.all(
          entries.map(async (request) => {
            if (!keep.has(new URL(request.url).pathname)) {
              await cache.delete(request).catch(() => {});
            }
          }),
        );
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      /*
       * A worker has to boot before it can decide anything, and the page load
       * waits on that — which showed up as time-to-first-byte going from 115ms
       * to 363ms once this was installed, handing back most of what caching the
       * CSS had won. Navigation preload starts the request for the page in
       * parallel with that boot, so the two overlap instead of queueing.
       */
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }

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

  /*
   * Pages are never cached — they carry one account's notes. But the preload
   * above only helps if its response is actually used, so navigations are
   * answered with it and fall back to the network. Still nothing stored.
   */
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const preloaded = await event.preloadResponse;

        return preloaded || fetch(request);
      })(),
    );

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
