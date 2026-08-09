# The iOS app and the web app

Memo ships **one** iOS app: `ios-web-wrapper/`, a `WKWebView` that loads
`https://memoai.eu`. The native SwiftUI app that used to live at `ios/` is
retired — see "Where the old app went" below.

## There is no syncing step

The wrapper bundles **no web assets**. It loads the production URL
(`AppConfig.productionURL`), so every Vercel deploy of `main` is live in the iOS
app immediately, with no App Store release. "Keep the iOS app up to date with
the web app" is not a task anyone has to remember; it is true by construction.

The corollary is the part that does need care: **a web change ships to iOS
users the moment it deploys, without going through App Review.** There is no
staged rollout and no version pinning. If a web change breaks the app, it breaks
it for everyone at once.

## What is native, and why

Only one thing: **recording**. `MediaRecorder` inside `WKWebView` cannot survive
the screen locking — iOS ends the microphone track (`track-ended`) when the app
backgrounds and WebKit suspends the web content process, which silently
truncates the lecture. A 30 second lock produced a 19 second file while the
page's timer kept counting.

So capture runs in `NativeAudioRecorder` (`AVAudioRecorder` + `UIBackgroundModes:
audio`), a Live Activity keeps the Lock Screen banner up, and the finished
`.m4a` is handed back to the page as a `Blob`. The page's own recording UI and
upload flow are untouched.

## The four contracts a web change can break

These are injected `WKUserScript`s that make assumptions about the page. Each
one fails **silently** — the website stays fine while the iOS app degrades.
Check the relevant row when touching these areas.

| Native file | Assumes the web app… | Symptom if broken |
|---|---|---|
| `RecordingBridgeScript.swift` | records via `MediaRecorder` + `getUserMedia({audio: true})`, reads the result from a `dataavailable` `Blob`, and accepts `audio/mp4` | Recording stops surviving the lock, or produces no file. **Highest risk.** |
| `NowPlaying.swift` | plays audio through an `<audio>`/`<video>` element, and the note title is in an `h1` | Lock Screen card loses its title, or shows the raw `document.title` |
| `EmbeddedBranding.swift` | uses `.brand-logo`, `.brand-logo-mark`, `.app-topbar` | Brand renders at the wrong size in-app |
| `AppConfig.swift` | authenticates only via `memoai.eu`, `*.supabase.co`, `accounts.google.com`, `appleid.apple.com` | A new auth provider or domain opens in Safari instead of in-app, breaking sign-in |

**If you rewrite the recorder on the web, you must update
`RecordingBridgeScript.swift` in the same change.** That is the one coupling
tight enough to break a paying user's lecture.

### `EmbeddedBranding` is redundant once the wordmark ships

Every rule that script injects — the `8rem` / `480:148` logo sizing, the flat
`.app-topbar` — already exists in `globals.css`, and it skips the image swap
when the page already serves `memo-wordmark.png`. Delete it **after** the web
app's single-file wordmark is deployed to production, not before: the wrapper
loads production, so removing it early regresses the in-app brand until the web
deploy lands.

## Where the old native app went

Retired 2026-08-09, not deleted. PR #143 was closed; the branch
`codex/ios-native-app` remains on GitHub (`git switch codex/ios-native-app`).
It was never merged to `main`. A local archive at
`~/Developer/memo-archives/native-ios-app/` holds the parts that existed nowhere else —
the local branch had drifted 13 commits behind origin while carrying one
unpushed commit and uncommitted edits. Its README explains what is what.

The wrapper reuses that app's Live Activity verbatim and ports its
`AVAudioRecorder` approach.

## Known open items

- **Now Playing cover art and pause button** do not appear in the Simulator.
  `title`/`artist` do, so the Media Session plumbing works; `artwork` and
  `setActionHandler` are being dropped. Tried a `data:` URI, the app's custom
  scheme, and same-origin https. Needs a physical device to settle. If a device
  also shows nothing, take playback native with `AVPlayer` +
  `MPNowPlayingInfoCenter`.
- **In-App Purchase.** Billing goes through Stripe and the wrapper has no
  StoreKit. A digital subscription bought inside the WebView is an App Store
  guideline 3.1.1 rejection. The retired native app had solved this; the wrapper
  has not.
- **Guideline 4.2** (minimum functionality) is the usual rejection for a WebView
  wrapper. The native recording and Live Activity are the counter-argument and
  should be named in the review notes, along with the visible feature that
  justifies `UIBackgroundModes: audio`.
