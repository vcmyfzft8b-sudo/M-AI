/*
 * Two jobs: the white frame between the launch screen and the app, and having
 * anything at all to show when there is no connection.
 *
 * iOS holds its launch image until the page's first paint, and first paint
 * waits on render-blocking CSS. Memo ships ~88 KB gzipped of it across three
 * files, so on a cold start there is a stretch where the document has arrived
 * and painted nothing — and a document that has painted nothing is white. That
 * is the flash. Measured: the same app launched with its assets already cached
 * shows no white frame at all, which is the whole idea here.
 *
 * Build output is cached by content hash, so a cached copy can never be stale —
 * a changed file is a changed URL.
 *
 * No page carrying an account's notes is ever cached, and that rule has not
 * moved: caching one would mean handing that account's library to whoever opens
 * the app next on the same device. What offline support adds is a page with
 * *nobody's* notes in it — `/offline`, which renders the app shell and then
 * fills it in from a per-account store in the browser — plus the note photos
 * the app has already displayed, which are keyed by their storage path so a
 * re-signed URL still finds them.
 */

const CACHE = "memo-static-v1";

/**
 * The document handed back for a navigation the network could not answer. It
 * is served under whatever address was asked for, so it works out which screen
 * to draw from `location` — see src/components/offline/offline-app.tsx.
 */
const SHELL_URL = "/offline";
const SHELL_CACHE_KEY = "/__memo_offline_shell";
const SHELL_META_KEY = "/__memo_offline_shell_meta";

/**
 * The backstop on how long a cached shell may be trusted.
 *
 * It is a backstop and not the mechanism: what actually invalidates the shell
 * is the build it was cut from changing, because a deploy is the only thing
 * that makes it wrong. Left to an age alone, a shell cached at nine in the
 * morning went on being served all day — so every screen reached with no
 * connection was yesterday's app, while the same screens online were current.
 * That is exactly the bug this constant used to be.
 */
const SHELL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Photos in a note. Supabase signs them for an hour, so the token in the URL is
 * different on every load and useless as a cache key; everything before the
 * query names the object and does not change.
 */
const SIGNED_STORAGE_MARKER = "/storage/v1/object/sign/";

/**
 * The icon font, and the stylesheet that names it.
 *
 * Every glyph in the app is a Material Symbols ligature — `.msym` renders the
 * literal text "arrow_back" when the font is missing — so an app opened with no
 * connection and no cached font is an app captioned with the names of its own
 * icons. Google serves both with `Access-Control-Allow-Origin: *`, which is
 * what makes them storable here at all.
 */
const FONT_ORIGINS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];

/**
 * The two pictures the app draws of itself. Kept with the shell rather than
 * waited for, because neither is requested by every screen: the memory palace
 * loads the mascot as a raw file for its minimap, and the palace is exactly the
 * kind of screen somebody opens for the first time on a train.
 */
const BRAND_ASSETS = ["/memo-mascot.png", "/memo-lockup.png"];

/**
 * Any cached size of the picture this URL asks for.
 *
 * Only ever reached with no connection, and only after the exact URL has
 * missed — online the optimiser answers properly and nothing here runs. A
 * larger copy scaled down is the right trade against a broken image.
 */
async function matchAnySize(cache, url) {
  const source = url.searchParams.get("url");

  if (!source) {
    return undefined;
  }

  for (const request of await cache.keys()) {
    const cached = new URL(request.url);

    if (isOptimisedImage(cached) && cached.searchParams.get("url") === source) {
      return cache.match(request, { ignoreVary: true });
    }
  }

  return undefined;
}

/** A picture served straight out of `public/`, rather than through the optimiser. */
function isStaticImage(url) {
  return (
    url.origin === self.location.origin && /\.(png|jpe?g|webp|svg|avif|ico)$/i.test(url.pathname)
  );
}

function isFontRequest(url) {
  return FONT_ORIGINS.includes(url.origin);
}

/**
 * Stores a font URL and, when it is the stylesheet, the face files it points
 * at.
 *
 * The files have to be read out of the CSS rather than waited for. They are
 * requested by the font engine only once the stylesheet has been parsed and
 * something on the page actually needs a glyph, which is after the page has
 * finished loading and told this worker what to keep — so on the launch that
 * installs the worker the face is never in that list, and the launch after it
 * is the first one with icons offline. Parsing closes that gap.
 */
async function cacheFont(cache, href) {
  const stored = await cache.match(href);
  const response = stored ?? (await fetch(href, { mode: "cors", credentials: "omit" }));

  if (!response || response.status !== 200) {
    return response;
  }

  if (!stored) {
    await cache.put(href, response.clone()).catch(() => {});
  }

  if (!href.startsWith("https://fonts.googleapis.com/")) {
    return response;
  }

  const css = await response.clone().text().catch(() => "");
  const faces = new Set();
  const pattern = /url\((https:\/\/fonts\.gstatic\.com\/[^)"']+)\)/g;
  let match = pattern.exec(css);

  while (match) {
    faces.add(match[1]);
    match = pattern.exec(css);
  }

  await Promise.all(
    [...faces].map(async (url) => {
      if (!(await cache.match(url))) {
        await cache.add(url).catch(() => {});
      }
    }),
  );

  return response;
}

/**
 * Roughly several deploys' worth of chunks. High enough that normal use — one
 * build, many screens, each adding its own — never trims; low enough that the
 * cache cannot grow until the browser evicts all of it.
 */
const MAX_ENTRIES = 300;

/**
 * Photos in notes, kept so a note read offline is not a note with holes in it.
 * Counted apart from the build files because they are evicted on different
 * evidence, and capped lower: each is a full-size photograph rather than a
 * compressed chunk.
 */
const MAX_PHOTO_ENTRIES = 150;

/** Content-hashed build output, and nothing else. */
function isCacheable(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
}

/**
 * The optimiser's output for the app's own pictures — the brand lockup in the
 * header, the mascot on the sign-in and offer cards.
 *
 * They are not under `/_next/static/`, so nothing else here would keep them,
 * and offline that showed as a broken-image frame where the lockup goes: the
 * one thing on the library screen that was visibly wrong. Their URLs carry the
 * source path and the size, not a content hash, so a replaced picture keeps its
 * URL — hence the background refresh below rather than a plain cache-first.
 */
function isOptimisedImage(url) {
  return url.origin === self.location.origin && url.pathname === "/_next/image";
}

/** A signed storage object, addressed by the part of the URL that is stable. */
function storageCacheKey(url) {
  return url.pathname.includes(SIGNED_STORAGE_MARKER) ? `${url.origin}${url.pathname}` : null;
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
  const data = event.data || {};

  if (data.type === "cache-shell") {
    event.waitUntil(cacheOfflineShell(data.locale, data.strings, data.fonts, data.build));
    return;
  }

  const urls = data.type === "cache-build" ? data.urls : null;

  if (!Array.isArray(urls)) {
    return;
  }

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const wanted = urls.filter((url) => {
        try {
          const parsed = new URL(url);

          /*
           * The optimiser's pictures are taken here as well as by the fetch
           * handler, and for the same reason the build files are: a worker does
           * not control the page that registers it, so on the launch that
           * installs it every one of them is fetched around it — and the next
           * launch, offline, drew the header with a broken image in it.
           */
          return isCacheable(parsed) || isOptimisedImage(parsed);
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
          wanted.map(async (url) =>
            (await cache.match(url, { ignoreVary: true })) ? null : url,
          ),
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
      await trimCache(cache, wanted);
    })(),
  );
});

/**
 * Keeps the cache from growing until the browser evicts all of it — which
 * would take the offline shell with it, not just a launch animation.
 *
 * Three kinds of entry live here and they are trimmed separately, because they
 * are not interchangeable: build files, which are replaced wholesale by every
 * deploy; note photos, which accumulate one note at a time; and the two shell
 * entries, which are never dropped while they exist — they are the difference
 * between an app that opens offline and a browser error page.
 */
async function trimCache(cache, currentBuildUrls) {
  const entries = await cache.keys();
  const build = [];
  const photos = [];

  for (const request of entries) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/_next/static/")) {
      build.push(request);
    } else if (BRAND_ASSETS.includes(url.pathname)) {
      /* Kept with the shell: the app draws itself with these. */
    } else if (storageCacheKey(url) || isOptimisedImage(url) || isStaticImage(url)) {
      photos.push(request);
    }
    /* The two shell entries and the icon font are never trimmed. */
  }

  /*
   * Past the cap, the page's own list is the best evidence available of what
   * is still current — and a build cache this size is already several deploys
   * of rubbish. Below it nothing is dropped: each page sends the chunks *it*
   * used, so trimming on every message would have the home screen evicting the
   * note screen's assets and back again forever.
   */
  if (build.length > MAX_ENTRIES) {
    const keep = new Set(currentBuildUrls.map((url) => new URL(url).pathname));

    await Promise.all(
      build
        .filter((request) => !keep.has(new URL(request.url).pathname))
        .map((request) => cache.delete(request).catch(() => {})),
    );
  }

  /*
   * Photos have no equivalent signal — nothing tells us which note will be
   * opened next — so the oldest go, which `cache.keys()` returns first.
   */
  if (photos.length > MAX_PHOTO_ENTRIES) {
    await Promise.all(
      photos
        .slice(0, photos.length - MAX_PHOTO_ENTRIES)
        .map((request) => cache.delete(request).catch(() => {})),
    );
  }
}

/**
 * Fetches `/offline` and everything it needs to run, so that a launch with no
 * connection has a whole app to open rather than a browser error page.
 *
 * The assets are read out of the document's own markup. There is no build-time
 * manifest to keep in step, and no guessing: whatever Next put in the shell's
 * `<script>` and `<link>` tags is exactly what the shell needs. Anything it
 * loads later — the note screen's chunk, for instance — is already in this
 * cache from ordinary use of the app, because it is the same chunk.
 *
 * The language is part of the decision. The shell is rendered server-side in
 * one language, so a reader who switches gets a fresh copy rather than an
 * offline app that speaks the language they left.
 */
async function cacheOfflineShell(locale, strings, fonts, build) {
  const cache = await caches.open(CACHE);

  /*
   * The font first and unconditionally, because it is not part of the shell's
   * own freshness question: the shell may be current while the font was never
   * stored, which is exactly what happens on the launch that installs this
   * worker. `cache.add` builds a CORS request from a bare URL, which is what
   * Google's stylesheet and font file both answer.
   */
  if (Array.isArray(fonts)) {
    await Promise.all(
      fonts
        .filter((url) => {
          try {
            return isFontRequest(new URL(url));
          } catch {
            return false;
          }
        })
        .map((url) => cacheFont(cache, url).catch(() => {})),
    );
  }

  await Promise.all(
    BRAND_ASSETS.map(async (path) => {
      if (!(await cache.match(path))) {
        await cache.add(path).catch(() => {});
      }
    }),
  );

  const meta = await readShellMeta(cache);

  /*
   * `meta.build` is the page's own runtime chunk, whose name carries a content
   * hash — so it changes on every deploy and on no other occasion. A shell cut
   * from a different build is stale no matter how recently it was fetched.
   */
  if (
    meta &&
    meta.locale === locale &&
    meta.build === build &&
    Date.now() - meta.cachedAt < SHELL_MAX_AGE_MS &&
    (await cache.match(SHELL_CACHE_KEY))
  ) {
    return;
  }

  let response;

  try {
    // Session cookies stay omitted, but the shell must use the reader's
    // selected language rather than re-detecting their IP country.
    const shellUrl = new URL(SHELL_URL, self.location.origin);
    shellUrl.searchParams.set("locale", locale || "en");
    response = await fetch(shellUrl.href, { credentials: "omit", cache: "no-store" });
  } catch {
    return;
  }

  if (!response || response.status !== 200) {
    return;
  }

  const html = await response.clone().text();

  /*
   * `credentials: "omit"` above is the safeguard that matters: the shell must
   * be the same document for every account on the device, and a request that
   * carried the session cookie could come back with something personal in it.
   * A page that redirected (to sign-in, say) is not the shell and is dropped.
   */
  if (response.redirected) {
    return;
  }

  await cache.put(SHELL_CACHE_KEY, new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }));
  await cache.put(
    SHELL_META_KEY,
    new Response(
      JSON.stringify({ locale, build: build || null, cachedAt: Date.now(), strings: strings || null }),
    ),
  );

  await Promise.all(
    assetUrlsIn(html).map((url) =>
      cache.match(url).then((hit) => (hit ? null : cache.add(url).catch(() => {}))),
    ),
  );
}

async function readShellMeta(cache) {
  const stored = await cache.match(SHELL_META_KEY);

  if (!stored) {
    return null;
  }

  try {
    return await stored.json();
  } catch {
    return null;
  }
}

/** Build files referenced by a document, as absolute same-origin URLs. */
function assetUrlsIn(html) {
  const found = new Set();
  const pattern = /(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g;
  let match = pattern.exec(html);

  while (match) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, "&"), self.location.origin);

      if (isCacheable(url)) {
        found.add(url.href);
      }
    } catch {
      /* A malformed attribute is not worth abandoning the rest for. */
    }

    match = pattern.exec(html);
  }

  return [...found];
}

/**
 * The last thing standing between the reader and a browser error page: the
 * shell was never cached (a first launch that was already offline) or its own
 * assets are missing. Deliberately tiny and self-contained — no build output,
 * no fonts — and in the reader's language where the page has told us one.
 */
function offlineFallbackDocument(strings) {
  const copy = strings || {};
  const title = copy.title || "You are offline";
  const body = copy.body || "Connect to the internet and open Memo again.";
  const retry = copy.retry || "Try again";

  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` +
      `<title>${escapeHtml(title)}</title><style>` +
      `:root{color-scheme:light dark}` +
      `body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem;` +
      `background:#f1f1f5;color:#121214;text-align:center;` +
      `font:500 1rem/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}` +
      `@media (prefers-color-scheme:dark){body{background:#121214;color:#f1f1f5}}` +
      `h1{font-size:1.5rem;font-weight:800;letter-spacing:-.03em;margin:0 0 .6rem}` +
      `p{margin:0 0 1.6rem;opacity:.7}` +
      `button{border:0;border-radius:999px;padding:.95rem 1.6rem;font:inherit;font-weight:700;` +
      `background:#121214;color:#f1f1f5;cursor:pointer}` +
      `@media (prefers-color-scheme:dark){button{background:#f1f1f5;color:#121214}}` +
      `</style></head><body><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>` +
      `<button onclick="location.reload()">${escapeHtml(retry)}</button></div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

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

      /*
       * A new worker means this file changed, which means a deploy — and the
       * shell it cached belongs to the deploy before it. Dropping it here is
       * what gets an app that is already out there unstuck on its next online
       * launch, rather than on whatever launch happens to fall after the age
       * limit. The page hands over a fresh one moments later.
       */
      const cache = await caches.open(CACHE);
      await cache.delete(SHELL_CACHE_KEY).catch(() => {});
      await cache.delete(SHELL_META_KEY).catch(() => {});

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
   * Pages are never cached — they carry one account's notes — so a navigation
   * is always the network, answered with the preload where there is one.
   *
   * What changes offline is only what happens when that fails: instead of the
   * browser's error page, the reader gets `/offline`, which is the app shell
   * with nobody's data in it. It is returned under the address that was asked
   * for rather than redirected to, so `location` still names the screen that
   * was wanted and the shell can draw it from the store in this browser.
   */
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          const response = preloaded || (await fetch(request));

          /*
           * A served page is proof the shell can be refreshed, and this is the
           * only moment we know the app is reachable without asking. Never on
           * the request's own path: `waitUntil` here would hold the navigation.
           */
          return response;
        } catch {
          const cache = await caches.open(CACHE);
          const shell = await cache.match(SHELL_CACHE_KEY);

          if (shell) {
            return shell;
          }

          const meta = await readShellMeta(cache);

          return offlineFallbackDocument(meta && meta.strings);
        }
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

  /*
   * The app's own pictures, served stale while a fresh copy is fetched behind
   * them. Cache-first because this is the launch path — the lockup is in the
   * header of the first screen — and revalidating keeps a replaced image from
   * being stuck forever behind a URL that never changes.
   */
  if (isOptimisedImage(url) || isStaticImage(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        /*
         * `ignoreVary` matters here and nowhere else. The optimiser answers with
         * `Vary: Accept` — it serves AVIF or WebP depending on what the client
         * says it takes — and a cached copy is otherwise only ever matched for a
         * request whose `Accept` is identical. The stored copy came from the
         * worker's own fetch (`Accept: *​/*`, so the original PNG); the `<img>`
         * that needs it asks for `image/avif,image/webp,…`, and the two never
         * matched. Offline that was a broken-image frame where the brand lockup
         * goes. Whatever format is stored renders; the header says which it is.
         */
        const hit = await cache.match(request, { ignoreVary: true });

        const refresh = fetch(request)
          .then((response) => {
            if (response && response.status === 200 && response.type === "basic") {
              cache.put(request, response.clone()).catch(() => {});
            }

            return response;
          })
          .catch(() => null);

        if (hit) {
          event.waitUntil(refresh);
          return hit;
        }

        const response = await refresh;

        if (response) {
          return response;
        }

        /*
         * Nothing cached under this exact URL and nothing reachable. Before
         * giving up, any other size of the same picture will do: the optimiser
         * keys on width and quality as well as the source, so a screen asking
         * for a size no other screen has asked for gets a miss even though the
         * picture itself is right here. That is what put a broken-image frame
         * in the middle of the memory palace, whose mascot is 110px wide and
         * nothing else's is.
         */
        const alternative = await matchAnySize(cache, url);

        return alternative ?? Response.error();
      })(),
    );

    return;
  }

  /*
   * A note's photos. Cached after they have been displayed once, and looked up
   * by storage path so the hourly re-signing that changes the URL does not lose
   * them — without this a note read offline is a note with holes in it.
   *
   * Network first, because a signed URL that still works is the freshest answer
   * and these are only ever read back when it does not.
   */
  /*
   * The icon font and its stylesheet, cache-first: the URLs are stable, the
   * files are immutable in practice, and this is the one cross-origin fetch the
   * app cannot do without. Cache-first rather than network-first because there
   * is nothing to be fresh about and a round trip to Google on every launch is
   * the launch delay the rest of this file exists to remove.
   */
  if (isFontRequest(url)) {
    event.respondWith(
      (async () => {
        /*
         * Re-issued as CORS inside `cacheFont` for the same reason the photos
         * are: a stylesheet link and a font face both ask in `no-cors` mode,
         * and an opaque reply has status 0, which `cache.put` refuses.
         */
        const cache = await caches.open(CACHE);

        return cacheFont(cache, url.href);
      })(),
    );

    return;
  }

  const storageKey = storageCacheKey(url);

  if (storageKey) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);

        try {
          /*
           * Re-issued as a CORS request rather than passing the original
           * through. A photo is loaded by an `<img>`, which asks in `no-cors`
           * mode and gets an opaque reply — and an opaque reply has status 0,
           * which `cache.put` refuses. Supabase storage allows any origin, so
           * asking properly is all it takes to get something storable, and the
           * image renders from it exactly the same.
           */
          const response = await fetch(url.href, { mode: "cors", credentials: "omit" });

          /*
           * Pictures only. The same signed-URL shape carries a lecture's audio
           * and its generated episodes, which run to tens of megabytes each and
           * would fill the origin's storage in a handful of notes — and unlike a
           * photo, neither is part of reading a note.
           */
          if (
            response &&
            response.status === 200 &&
            (response.headers.get("Content-Type") || "").startsWith("image/")
          ) {
            cache.put(storageKey, response.clone()).catch(() => {});
          }

          return response;
        } catch (error) {
          const hit = await cache.match(storageKey);

          if (hit) {
            return hit;
          }

          throw error;
        }
      })(),
    );

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
