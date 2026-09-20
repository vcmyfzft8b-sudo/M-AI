# Offline

Memo opens, and reads, with no connection. The library, every note that has been
opened, its cards, its quiz, its practice test, its transcript, its mind map and
its photos are all there. What is not there is anything the model has to make or
speak on the spot — and each of those says so, where you meet it.

This is one feature across both surfaces. The browser, the installed PWA and the
iOS wrapper all get it from the same service worker and the same components;
there is no separate offline build.

## How it works

Every `/app` screen is server-rendered from the database, so with the network
gone there is nothing to render — not a stale page, an empty one. Three pieces
close that gap.

**The snapshot** (`src/lib/offline/snapshot.ts`). While online, each screen
writes what the server just handed it into IndexedDB: the library, the folders,
and the full detail of every note that has actually been opened. Only a `ready`
note is kept — one still being transcribed would be cached as a progress screen
that can never progress. The store is per account: `meta.userId` is checked on
every read and the whole database is dropped when it does not match, so a second
account on a shared phone can never surface the first one's notes.

**The shell** (`src/app/offline/page.tsx`). A page with nobody's data in it,
fetched by the service worker while online (without the session cookie) and
handed back for *any* navigation the network cannot answer — under the address
that was asked for, not redirected to. So `location` still names the screen that
was wanted, and `OfflineApp` mounts the real `HomeDashboard` or `LectureWorkspace`
against the snapshot. Same components, same CSS, same behaviour: offline is not
meant to look like a different app.

**The stub** (`src/lib/offline/api.ts`). Installed over `window.fetch` and a
straight pass-through while there is a connection. Offline it answers the reads
the snapshot holds, queues the two study writes (see below), and refuses
everything else with `503` and `code: "offline"` — which every screen in the app
already knows how to put in front of the reader. Without that refusal, an upload
offline fails with whatever the engine calls a dropped connection ("Load failed"
in Safari), which is English, unexplained, and reads as a crash.

Navigation offline goes through the document rather than the router
(`navigation-loading.tsx`): a client-side navigation would fetch a payload that
cannot be fetched. Every asset is already cached, so it is not the slow path it
would be online.

### Writes

Only two are queued (`src/lib/offline/outbox.ts`), and both because they are the
byproduct of *reading*: answering a flashcard and moving through a study session.
The card screen rolls its whole advance back when a progress write fails, so
without the queue a deck offline simply refuses to turn. They replay in order
when the connection returns, and an entry is dropped as soon as the server
answers at all — a rejected write will be rejected again, and a queue that never
drains blocks every write behind it.

Everything else a user can author — creating a note, editing one, renaming,
deleting, moving to a folder, asking the model anything — stays refused. Those
are authored changes; replaying them silently hours later against a library that
has moved on is worse than being told to come back online.

## What the reader sees

There is **no standing "you are offline" chrome anywhere**. That is deliberate,
and a banner across every screen was built first and taken out again: being
offline is not news to somebody who is offline. It is a thing to find out at the
one moment it matters.

So there are three small pieces, each shown only at that moment, and each quieter
than its nearest neighbour in the app (`.memo-offline-*` in `redesign.css`):

| | where | what |
| --- | --- | --- |
| `OfflineFeatureNotice` | a tab that is a live service — the walkthrough, the episode, a map never drawn | muted glyph, a line, a quiet "Check again" |
| `OfflineToast` (`.memo-toast.subtle`) | a control that is on screen but cannot act — create, rename, delete, read aloud | a surface pill with a hairline, gone in three seconds |
| `.memo-offline-inline` | in place of something that cannot load — the recording's player above a transcript that reads fine | one muted row |

Detection is in `offline-provider.tsx`. `navigator.onLine === false` is believed
at once; true is not, because it is also what a hotel captive portal and a phone
with one bar of nothing look like — so everything else is decided by a probe
against `/api/health`, and a request that dies in transport asks for one. The
cached shell starts offline whatever the interface says: the shell being on
screen is itself the evidence.

## iOS

Two things had to be true in the wrapper before any of this ran, and neither is
optional:

- **`WKAppBoundDomains` in `Info.plist`**, plus
  `limitsNavigationsToAppBoundDomains` on the web view configuration. WKWebView
  runs a service worker only for an app-bound domain. Without both halves the
  page's `navigator.serviceWorker.register` never fires — measured: zero requests
  for `/sw.js` — and the app has nothing to open. It is switched off for a Vercel
  preview, whose host changes per deployment and so cannot be in a static list.
- **A secure origin.** WKWebView does not extend secure-context status to
  `http://localhost` the way browsers do, so a plain local dev server cannot
  exercise offline mode at all.
- **The origin the app opens must be the origin the worker is on.** `memoai.eu`
  307s to `www.memoai.eu`, so the app always *ended up* on `www` — by redirect,
  which nothing cared about until now. A worker belongs to exactly one origin,
  so a cold launch with no connection asking for the apex lands where nothing is
  registered and nothing can intercept: the native "could not connect" screen,
  with the whole cached library sitting behind it. `AppConfiguration` opens
  `www` directly, and a main-frame navigation to the apex is rewritten rather
  than followed.

### Checking it on a simulator

```sh
npm run build && npx next start -p 3100            # a production build; dev registers no worker
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout key.pem -out cert.pem -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost" -addext "basicConstraints=critical,CA:TRUE"
xcrun simctl keychain <udid> add-root-cert cert.pem
```

Put a TLS proxy on 3443 in front of 3100 (twenty lines of `node:https` piping to
`node:http`), then:

```sh
xcrun simctl install <udid> <MemoAI.app>
SIMCTL_CHILD_MEMO_IOS_URL=https://localhost:3443 xcrun simctl launch <udid> eu.memoai.memo
```

Open the library and one note so both are captured, **stop the proxy and the
server**, and relaunch. The app should open on its library with no connection at
all. Two ways to check the worker really installed, since none of it is visible:

```sh
APP=$(xcrun simctl get_app_container <udid> eu.memoai.memo data)
sqlite3 "$(find "$APP" -name 'ServiceWorkerRegistrations-8.sqlite3')" 'select * from Records;'
find "$APP/Library/WebKit" -type d -name CacheStorage -exec du -sh {} \;
```

## Traps worth knowing

- **Two things must be precached, not waited for.** A worker does not control
  the page that registers it, so on the launch that installs it every asset is
  fetched *around* it. The page therefore posts its build files and the icon
  font to the worker afterwards. Miss the font and a cold offline launch is
  captioned with the names of its own icons — every glyph is a ligature, so
  `.msym` renders the literal text "arrow_back".
- **The font faces are read out of the stylesheet**, not taken from the page's
  resource list: the engine only requests a face once something needs a glyph,
  which is after the page has finished loading and reported what it used.
- **`ignoreVary` on the optimiser's pictures.** `/_next/image` answers
  `Vary: Accept`; the worker's own fetch stores the PNG, the `<img>` asks for
  `image/avif,…`, and without it the two never match — which showed as a broken
  frame where the brand lockup goes.
- **A note's photos are keyed by storage path.** Supabase re-signs them hourly,
  so the token in the URL is useless as a key; everything before the query names
  the object. Audio is deliberately *not* cached — the same URL shape carries
  lecture recordings and generated episodes, tens of megabytes each.
- **Registration cannot wait on `load` alone.** One subresource that never
  settles means it never fires; measured on this app with `readyState` stuck at
  `"interactive"` and no worker registered at all. There is a 2.5s floor.
- **The worker never runs in development.** The dev server rewrites the same
  asset URLs on every edit, so a cache-first worker in front of it serves the
  build from ten minutes ago.
