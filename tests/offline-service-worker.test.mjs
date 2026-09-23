import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The worker, run.
 *
 * Everything the app can do with no connection hangs off this file: it is what
 * answers a navigation the network could not, and the difference between the
 * app opening and a browser error page is one `catch` in its fetch handler. So
 * it is loaded into a fake worker global here and actually driven, rather than
 * read for the right-looking strings.
 */

const source = readFileSync(
  fileURLToPath(new URL("../public/sw.js", import.meta.url)),
  "utf8",
);

const ORIGIN = "https://memoai.eu";

/** A Cache Storage that behaves the way the worker relies on it behaving. */
function createCaches() {
  const stores = new Map();

  const makeCache = (entries) => ({
    async match(request, options) {
      const url = typeof request === "string" ? request : request.url;
      const hit = entries.get(new URL(url, ORIGIN).href);

      if (!hit) {
        return undefined;
      }

      // Cached under one `Accept`, asked for under another: only an explicit
      // `ignoreVary` may match. See the optimised-image branch.
      if (hit.vary && !options?.ignoreVary) {
        return undefined;
      }

      return hit.response;
    },
    async put(request, response) {
      const url = typeof request === "string" ? request : request.url;
      entries.set(new URL(url, ORIGIN).href, { response, vary: response.vary ?? false });
    },
    async add(url) {
      entries.set(new URL(url, ORIGIN).href, { response: { status: 200 }, vary: false });
    },
    async delete(request) {
      const url = typeof request === "string" ? request : request.url;
      return entries.delete(new URL(url, ORIGIN).href);
    },
    async keys() {
      return [...entries.keys()].map((url) => ({ url }));
    },
    entries,
  });

  return {
    stores,
    async open(name) {
      if (!stores.has(name)) {
        stores.set(name, makeCache(new Map()));
      }

      return stores.get(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
  };
}

function loadWorker({ fetchImpl } = {}) {
  const listeners = new Map();
  const caches = createCaches();
  const fetched = [];

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, handler) => listeners.set(type, handler),
    skipWaiting: () => {},
    registration: { navigationPreload: { enable: async () => {} } },
    clients: { claim: async () => {} },
  };

  const fetchFn =
    fetchImpl ??
    (async (input) => {
      fetched.push(typeof input === "string" ? input : input.url);
      return { status: 200, type: "basic", clone: () => ({ text: async () => "" }), headers: new Map() };
    });

  const context = {
    self,
    caches,
    fetch: (...args) => {
      fetched.push(typeof args[0] === "string" ? args[0] : args[0].url);
      return fetchFn(...args);
    },
    Response: class {
      constructor(body, init) {
        this.body = body;
        this.status = init?.status ?? 200;
        this.headers = new Map(Object.entries(init?.headers ?? {}));
      }
      static error() {
        return { status: 0, error: true };
      }
    },
    URL,
    Date,
    Promise,
    Set,
    JSON,
    String,
    Array,
    console,
  };

  new Function(...Object.keys(context), source)(...Object.values(context));

  return { listeners, caches, fetched, self };
}

/** Drives the fetch handler and returns what it answered with, or null. */
async function handleFetch(worker, request, { preload } = {}) {
  let answer = null;
  const waits = [];

  worker.listeners.get("fetch")({
    request,
    preloadResponse: preload ?? Promise.resolve(undefined),
    respondWith: (value) => {
      answer = value;
    },
    waitUntil: (value) => waits.push(value),
  });

  await Promise.all(waits.map((value) => Promise.resolve(value).catch(() => {})));
  return answer ? await answer : null;
}

const navigation = (path) => ({
  url: `${ORIGIN}${path}`,
  method: "GET",
  mode: "navigate",
});

test("a navigation that cannot be answered gets the cached shell, under its own address", async () => {
  const worker = loadWorker({
    fetchImpl: async () => {
      throw new TypeError("Load failed");
    },
  });
  const cache = await worker.caches.open("memo-static-v1");
  await cache.put("/__memo_offline_shell", { status: 200, shell: true });

  const answer = await handleFetch(worker, navigation("/app/lectures/abc"));

  assert.equal(answer.shell, true, "the note address is answered with the shell");
});

test("with no shell cached, the reader still gets a page rather than a browser error", async () => {
  const worker = loadWorker({
    fetchImpl: async () => {
      throw new TypeError("Load failed");
    },
  });
  const cache = await worker.caches.open("memo-static-v1");
  await cache.put(
    "/__memo_offline_shell_meta",
    { status: 200, json: async () => ({ strings: { title: "Ni povezave" } }) },
  );

  const answer = await handleFetch(worker, navigation("/app"));

  assert.match(answer.body, /Ni povezave/, "and in the language the page last reported");
  assert.equal(answer.headers.get("Content-Type"), "text/html; charset=utf-8");
});

/*
 * The rule the whole design rests on: a page carries one account's notes, and
 * caching one would hand that account's library to whoever opens the app next
 * on the same device.
 */
test("a page that was served is never stored", async () => {
  const worker = loadWorker();
  const answer = await handleFetch(worker, navigation("/app"));

  assert.equal(answer.status, 200);

  const cache = await worker.caches.open("memo-static-v1");
  assert.deepEqual(await cache.keys(), [], "nothing about that page was kept");
});

test("navigation preload is used when it has already answered", async () => {
  const worker = loadWorker();
  const preloaded = { status: 200, preloaded: true };

  const answer = await handleFetch(worker, navigation("/app"), {
    preload: Promise.resolve(preloaded),
  });

  assert.equal(answer.preloaded, true);
});

test("the icon font is answered from the cache, so glyphs are not their own names", async () => {
  const worker = loadWorker({
    fetchImpl: async () => {
      throw new TypeError("Load failed");
    },
  });
  const cache = await worker.caches.open("memo-static-v1");
  const href = "https://fonts.gstatic.com/s/materialsymbolsrounded/v1/font.woff2";
  await cache.put(href, { status: 200, font: true });

  const answer = await handleFetch(worker, { url: href, method: "GET", mode: "no-cors" });

  assert.equal(answer.font, true);
});

/*
 * Next's optimiser answers `Vary: Accept`. The copy this worker stores comes
 * from its own fetch (`Accept: *​/*`); the `<img>` that needs it asks for
 * `image/avif,…`, and without `ignoreVary` the two never match — which showed
 * as a broken frame where the brand lockup goes.
 */
test("a cached picture is found even though the optimiser varies on Accept", async () => {
  const worker = loadWorker({
    fetchImpl: async () => {
      throw new TypeError("Load failed");
    },
  });
  const cache = await worker.caches.open("memo-static-v1");
  await cache.put(`${ORIGIN}/_next/image?url=%2Fmemo-lockup.png&w=1080&q=75`, {
    status: 200,
    lockup: true,
    vary: true,
  });

  const answer = await handleFetch(worker, {
    url: `${ORIGIN}/_next/image?url=%2Fmemo-lockup.png&w=1080&q=75`,
    method: "GET",
    mode: "no-cors",
  });

  assert.equal(answer.lockup, true);
});

/*
 * Supabase re-signs a note's photos every hour, so the token in the URL is
 * different on every load and useless as a key. Everything before the query
 * names the object and does not change.
 */
test("a note's photo is found again under a freshly signed URL", async () => {
  const path = "/storage/v1/object/sign/memo/notes/photo.jpg";
  const worker = loadWorker({
    fetchImpl: async () => {
      throw new TypeError("Load failed");
    },
  });
  const cache = await worker.caches.open("memo-static-v1");
  await cache.put(`https://db.supabase.co${path}`, { status: 200, photo: true });

  const answer = await handleFetch(worker, {
    url: `https://db.supabase.co${path}?token=a-completely-different-token`,
    method: "GET",
    mode: "no-cors",
  });

  assert.equal(answer.photo, true);
});

test("trimming the cache never drops the shell", async () => {
  const worker = loadWorker();
  const cache = await worker.caches.open("memo-static-v1");
  await cache.put("/__memo_offline_shell", { status: 200, shell: true });
  await cache.put("/__memo_offline_shell_meta", { status: 200 });

  for (let index = 0; index < 340; index += 1) {
    await cache.put(`${ORIGIN}/_next/static/chunks/old-${index}.js`, { status: 200 });
  }

  const waits = [];
  worker.listeners.get("message")({
    data: { type: "cache-build", urls: [`${ORIGIN}/_next/static/chunks/current.js`] },
    waitUntil: (value) => waits.push(value),
  });
  await Promise.all(waits);

  const kept = (await cache.keys()).map((entry) => entry.url);
  assert.ok(
    kept.some((url) => url.endsWith("/__memo_offline_shell")),
    "the one thing that makes the app open offline",
  );
  assert.ok(kept.some((url) => url.endsWith("/_next/static/chunks/current.js")));
  assert.ok(
    !kept.some((url) => url.includes("old-0.js")),
    "several deploys of rubbish do go",
  );
});

test("the public shell carries the selected locale without session credentials", async () => {
  for (const locale of ["en", "sl", "hr", "bs", "sr"]) {
    let requested;
    const worker = loadWorker({ fetchImpl: async (url, options) => {
      requested = { url, options };
      return { status: 200, redirected: false, clone: () => ({ text: async () => "<html></html>" }) };
    } });
    const waits = [];
    worker.listeners.get("message")({
      data: { type: "cache-shell", locale, build: "current", fonts: [] },
      waitUntil: (work) => waits.push(work),
    });
    await Promise.all(waits);
    assert.equal(new URL(requested.url).pathname, "/offline");
    assert.equal(new URL(requested.url).searchParams.get("locale"), locale);
    assert.equal(requested.options.credentials, "omit");
    assert.equal(requested.options.cache, "no-store");
  }
});

/*
 * The optimiser keys on width and quality as well as the source, so a screen
 * asking for a size no other screen asks for misses even though the picture is
 * right there. That is what put a broken-image frame in the middle of the
 * memory palace, whose mascot is 110px wide and nothing else's is.
 */
test("a picture is found at another size when its own size was never cached", async () => {
  const worker = loadWorker({
    fetchImpl: async () => {
      throw new TypeError("Load failed");
    },
  });
  const cache = await worker.caches.open("memo-static-v1");
  await cache.put(`${ORIGIN}/_next/image?url=%2Fmemo-mascot.png&w=640&q=75`, {
    status: 200,
    mascot: true,
    vary: true,
  });

  const answer = await handleFetch(worker, {
    url: `${ORIGIN}/_next/image?url=%2Fmemo-mascot.png&w=256&q=75`,
    method: "GET",
    mode: "no-cors",
  });

  assert.equal(answer.mascot, true, "a larger copy scaled down beats a broken image");
});

test("a picture served straight out of public/ is cached too", async () => {
  const worker = loadWorker({
    fetchImpl: async () => {
      throw new TypeError("Load failed");
    },
  });
  const cache = await worker.caches.open("memo-static-v1");
  await cache.put(`${ORIGIN}/memo-mascot.png`, { status: 200, raw: true });

  const answer = await handleFetch(worker, {
    url: `${ORIGIN}/memo-mascot.png`,
    method: "GET",
    mode: "no-cors",
  });

  assert.equal(answer.raw, true, "the palace loads this one as a raw file for its minimap");
});

test("the pictures the app draws itself with are never trimmed away", async () => {
  const worker = loadWorker();
  const cache = await worker.caches.open("memo-static-v1");
  await cache.put(`${ORIGIN}/memo-mascot.png`, { status: 200 });
  await cache.put(`${ORIGIN}/memo-lockup.png`, { status: 200 });

  for (let index = 0; index < 200; index += 1) {
    await cache.put(`${ORIGIN}/notes/photo-${index}.png`, { status: 200 });
  }

  const waits = [];
  worker.listeners.get("message")({
    data: { type: "cache-build", urls: [] },
    waitUntil: (value) => waits.push(value),
  });
  await Promise.all(waits);

  const kept = (await cache.keys()).map((entry) => entry.url);
  assert.ok(kept.includes(`${ORIGIN}/memo-mascot.png`));
  assert.ok(kept.includes(`${ORIGIN}/memo-lockup.png`));
});

/*
 * The shell is the entry point for every screen reached with no connection, so
 * a stale one means the whole offline app is the previous deploy — which is
 * what shipped: a shell cached in the morning was still being served that
 * evening, while the same screens online were current. Age alone cannot see a
 * deploy; the build token can.
 */
test("a shell cut from a different build is replaced, however recently it was cached", async () => {
  let fetched = 0;
  const worker = loadWorker({
    fetchImpl: async () => {
      fetched += 1;
      return {
        status: 200,
        type: "basic",
        redirected: false,
        clone: () => ({ text: async () => "<html></html>" }),
        headers: new Map(),
      };
    },
  });
  const cache = await worker.caches.open("memo-static-v1");
  await cache.put("/__memo_offline_shell", { status: 200 });
  await cache.put("/__memo_offline_shell_meta", {
    status: 200,
    json: async () => ({ locale: "sl", build: "webpack-OLD.js", cachedAt: Date.now() }),
  });

  const send = async (build) => {
    const waits = [];
    worker.listeners.get("message")({
      data: { type: "cache-shell", locale: "sl", build, fonts: [] },
      waitUntil: (value) => waits.push(value),
    });
    await Promise.all(waits);
  };

  await send("webpack-OLD.js");
  assert.equal(fetched, 0, "same build, cached minutes ago: nothing to do");

  await send("webpack-NEW.js");
  assert.ok(fetched > 0, "a new build must refetch the shell even though it is fresh");
});

/*
 * And for apps already out there carrying a stale shell: a new worker means
 * this file changed, which means a deploy, so the shell it cached belongs to
 * the deploy before it.
 */
test("activating a new worker drops the shell the old one cached", async () => {
  const worker = loadWorker();
  const cache = await worker.caches.open("memo-static-v1");
  await cache.put("/__memo_offline_shell", { status: 200, stale: true });
  await cache.put("/__memo_offline_shell_meta", { status: 200 });
  await cache.put(`${ORIGIN}/_next/static/chunks/keep.js`, { status: 200 });

  const waits = [];
  worker.listeners.get("activate")({ waitUntil: (value) => waits.push(value) });
  await Promise.all(waits);

  const kept = (await cache.keys()).map((entry) => entry.url);
  assert.ok(!kept.some((url) => url.includes("__memo_offline_shell")), "both shell entries go");
  assert.ok(kept.some((url) => url.endsWith("keep.js")), "the build cache is untouched");
});
