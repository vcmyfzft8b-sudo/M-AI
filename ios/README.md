# Memo iOS app

A native shell around the production web app at `https://memoai.eu`. The app is one full-screen
`WKWebView` plus the native behaviour a bare web view does not provide: a launch splash, an
offline state, pull to refresh, share-sheet downloads, external-link routing, microphone and
camera permissions, and deep links.

There is no product logic here. Every screen, string and feature comes from the web app, so
shipping a web change ships it to the app with no App Store release.

## Requirements

- Xcode 16 or newer (the project uses `objectVersion = 77` file-system-synchronised groups, so
  adding a Swift file to `MemoWeb/` needs no project-file edit)
- iOS 16.2 or newer (ActivityKit's `ActivityContent`), iPhone only, portrait only

## Build, run, test

```bash
open ios/MemoWeb.xcodeproj
```

From the command line:

```bash
cd ios && xcodebuild test -scheme MemoWeb -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO
```

CI runs the same tests on every change under `ios/` — see
[.github/workflows/ios-app.yml](../.github/workflows/ios-app.yml).

## Layout

| Path | What it does |
| --- | --- |
| `MemoWeb/App/` | `AppDelegate`, `SceneDelegate`, deep-link entry |
| `MemoWeb/Web/WebViewController.swift` | The whole UI: web view, overlays, all WebKit delegates |
| `MemoWeb/Web/NavigationPolicy.swift` | Which URLs render in-app vs Safari vs the system |
| `MemoWeb/Web/NativeRouting.swift` | Launch destination and the landing-page rewrite |
| `MemoWeb/Web/DeepLink.swift` | `memo://` and universal links → a web URL |
| `MemoWeb/Web/DownloadCoordinator.swift` | Server and `blob:` downloads → share sheet |
| `MemoWeb/Resources/bridge.js` | Injected `window.MemoNative` bridge |
| `Support/Info.plist` | Bundle config, permissions, `MemoBaseURL` |
| `MemoWebTests/` | Unit tests for the routing and policy logic |

`NavigationPolicy`, `NativeRouting` and `DeepLink` are deliberately free of UIKit so the rules
that decide where a tap goes are unit tested rather than verified by hand in the simulator.

## Working against local web code

The app is a shell around a web app, so most iOS work needs a web app to point at — and waiting
for a change to reach production is not a workflow. A Debug build can be pointed anywhere.

Start the web server in the repo root, then:

```bash
ios/scripts/run-local.sh          # against http://localhost:3000
ios/scripts/run-local.sh 3001     # another port
ios/scripts/run-local.sh https://your-branch.vercel.app
```

It boots the simulator, builds, installs and launches against that server, and tails the log.

**Or switch from inside the app: shake the device** (Simulator: Device ▸ Shake, or `⌃⌘Z`) for a
sheet listing Production, the usual local ports, and Custom… for anything else. The choice
persists across launches, so you can leave a build pointed at your dev server. A `-MemoBaseURL`
launch argument outranks it, so a scripted run always lands where you asked.

Three things make this work, all Debug-only or harmless in Release:

- `NSAllowsLocalNetworking` in `Support/Info.plist` — without it ATS blocks cleartext to
  `localhost` and, unhelpfully, WebKit reports no error at all.
- `AppConfig.allowedDomains` always contains the current base URL's host, so the navigation
  policy does not bounce your own dev server out to Safari.
- The saved last-location is scoped to the host that saved it, so switching servers cannot
  resurrect the previous one on next launch.

Debug builds also allow `*.vercel.app` so a preview deployment renders in-app; Release does not.

A physical device cannot reach the Mac on `localhost` — use the LAN address, which
`run-local.sh` prints on start, via Custom…

**Note that a native capability needs its web half deployed.** `getNativeRecorder()` returns
`null` against a web build that predates it, and recording quietly falls back to `MediaRecorder`
— which is correct behaviour, but it means testing native recording against production only
works once the web change is live.

## Configuration

The shipping URL lives in `Support/Info.plist` under `MemoBaseURL`. That is the only place to
change it for Release; everything above affects Debug only.

## Behaviour worth knowing

**It opens into the product, not the marketing site.** Launch goes straight to `/app`. The web
app redirects a signed-out visitor from `/app` to `/` (see `requireUser()` in
`src/lib/auth.ts`), and `/auth/logout` does the same — so the wrapper rewrites any navigation
to `/` into `/auth/continue`, the same entry point the landing page's buttons use. The
navigation is cancelled before it commits, so the landing page never flashes.

**Sessions persist.** The web view uses the default persistent data store, so the Supabase
session cookie survives relaunches. The last non-auth page is remembered for 7 days and
restored on a cold launch.

**The user agent is Safari-shaped.** WKWebView's stock user agent omits the `Version/` and
`Safari/` tokens, which makes sniffing treat the app as an unknown browser. `AppConfig` restores
them and appends `MemoiOS/<version>` so the server can still identify the app.

**Chrome follows the page.** The status bar style and the safe-area bands are derived from
WebKit's `underPageBackgroundColor`, so light and dark themes track the web app with no bridge
round trip.

**Off-domain links open in Safari.** Only the product, its auth providers, Supabase and Stripe
render in-app (`AppConfig.inAppDomains`). Everything else gets `SFSafariViewController`, so
third-party pages keep the address bar and trust indicators.

**Legal pages open in Safari too**, even though the product serves them — the address bar
showing `memoai.eu` is what makes the consent on the sign-in screen meaningful. This one needs
handling in two places, because the terms and privacy links are Next.js `<Link>` components:
the App Router navigates with `history.pushState`, so WebKit never issues a navigation action
and the native delegate never sees the click. `NativeRouting.opensInBrowser` covers real page
loads, and a capture-phase click listener in `bridge.js` covers client-side routing. The path
list lives in `NativeRouting.browserPathPrefixes` and is injected into the bridge, so the two
cannot drift apart.

The same caveat applies to anything else you want to route natively: **a same-origin link
handled by the Next.js router will not reach `WKNavigationDelegate`.**

## The `window.MemoNative` bridge

`bridge.js` runs at document start on the main frame. Its presence is the signal that the page
is inside the native shell:

```js
if (window.MemoNative) {
  window.MemoNative.haptic("success");
  window.MemoNative.share({ url: location.href, text: "Poglej moj zapisek" });
  window.MemoNative.openExternal("https://example.com");
}
```

`document.documentElement` also carries `data-memo-native="ios"`, so CSS alone can hide
browser-only affordances.

Server-side, the same thing is detected from the user agent — see `src/lib/native-app.ts`. Use
that for anything the page must get right on first render or that an API route has to enforce;
the bridge only exists once JavaScript has run, and never on the server. Purchase gating uses
it, and so does the onboarding flow, which swaps its "add to home screen" walkthrough for a
closing step in the app, where those Safari instructions make no sense.

## Native recording

Recording is captured natively with `AVAudioRecorder`, not by the page. The web app's recording
UI is untouched — same sheet, same controls, same timer — only the engine underneath is
different, because `MediaRecorder` in a `WKWebView` stops the instant the web view stops being
frontmost. Locking the phone or pressing Home truncated the lecture silently; measured before
the change, a recording finalised at exactly the second the screen locked.

The split is deliberate: **native owns capture, the web app owns everything else.** When
recording stops, `RecordingSchemeHandler` serves the finished file over a custom
`memo-recording://` scheme, the page fetches it into a `File`, and hands it to the same
`replaceAudioSource` call a browser recording used. Lecture creation, the signed upload,
billing and processing therefore have exactly one implementation, in the web app.

Passing the bytes through the message bridge was the alternative and is not viable — an hour of
audio is ~29 MB and base64 inflates it by a third before it reaches JS.

Web code opts in by feature detection, so a browser is unaffected:

```ts
import { getNativeRecorder } from "@/lib/native-recorder";

const recorder = getNativeRecorder();   // null outside the iOS app
```

Verified end to end against a local build of the web app: 85.0 s captured against 85.1 s of wall
clock, across ~35 s with the screen locked, arriving in the page as a 716 KB `audio/mp4` File.

`AudioCaptureController` also handles interruptions — a phone call or Siri pauses the recorder
and resumes it afterwards, rather than leaving the UI claiming to record silence.

## Lock Screen recording activity

`MemoWidgets` is a WidgetKit app extension carrying the Live Activity ported from the archived
native SwiftUI app (`~/Developer/memo-ios-archive`): the same Lock Screen card, Dynamic Island
expanded / compact / minimal layouts, brand mark, wordmark and live timer.

It is driven by `AudioCaptureController` through `RecordingActivityController`, so it shows
exactly what the recorder is doing — running, paused by a phone call, or stopped.
`RecordingSession` keeps the pause/resume arithmetic in a pure value type so the timer is unit
tested rather than eyeballed on a Lock Screen.

This only works because capture is native. Driving it from the page's `getUserMedia` track
(`WKWebView.microphoneCaptureState`) was the first attempt and cannot work: a Live Activity is
only visible while the app is *not* frontmost, and that is precisely when WebKit ends the web
track — the activity would end in the same instant it became visible.

`-MemoDebugKeepActivity 1` (Debug only) holds the activity open after capture ends, which is
useful for inspecting the widget's rendering without recording for a minute first.

## Deep links

`memo://` works with no server setup. `memo://lectures/42` and `memo:///app/lectures/42` both
resolve against the base URL; a bare `memo://` opens `/app`.

Universal links (tapping a `memoai.eu` link anywhere in iOS and landing in the app) are wired up
in `SceneDelegate` but not enabled, because they need two things this repo cannot provide on its
own:

1. The **Associated Domains** capability with `applinks:memoai.eu`, which needs the Team ID.
2. An `apple-app-site-association` file served from `https://memoai.eu/.well-known/`, as JSON
   with no extension and `Content-Type: application/json`.

Once both exist, no Swift change is needed.

## Before the first App Store submission

Signing is not configured — `DEVELOPMENT_TEAM` is deliberately empty so the project builds for
anyone. Set your team in Xcode's Signing & Capabilities tab and register both bundle IDs:
`eu.memoai.app` and `eu.memoai.app.widgets`.

### Guideline work already done

| Guideline | Requirement | Where |
| --- | --- | --- |
| 3.1.1 | No purchasing outside IAP in the app | Paywall hides plans/price/checkout and `/api/billing/checkout` returns 403 for native callers, both driven by `src/lib/native-app.ts` |
| 5.1.1(v) | In-app account deletion | Settings → Izbriši račun (`src/components/delete-account-card.tsx`, `src/app/api/account/delete/route.ts`) |
| 2.1 | Reviewer must be able to sign in | `/auth/password` — unlinked, noindex, for the demo account |
| 2.5.13 | Privacy manifest | `MemoWeb/Resources/PrivacyInfo.xcprivacy` |

### Still to do — needs the Apple Developer account

1. **Sign in with Apple (Guideline 4.8).** Offering Google means Apple must be offered too. The
   code already supports it (`src/app/auth/apple/route.ts`); the button appears on its own once
   `providers.apple` turns true. Create a Services ID and a Sign in with Apple key in the
   developer portal, then fill in Team ID / Services ID / Key ID / `.p8` in Supabase →
   Authentication → Providers → Apple, with the Supabase `/auth/v1/callback` as the return URL.
   This lights it up on web and iOS at once.
2. **A demo account with a password**, given to review in the notes. Create the account, then set
   a password for it — for example through the Supabase dashboard, or:
   ```
   curl -X PUT "$SUPABASE_URL/auth/v1/admin/users/<user-id>" \
     -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
     -H "content-type: application/json" -d '{"password":"<strong-password>"}'
   ```
   Give it paid access so the reviewer can exercise the whole app.
3. **App Store Connect record**: name, category (Education), privacy policy URL
   (`/legal/privacy-policy`), support URL, screenshots.
4. **Privacy answers** must match `PrivacyInfo.xcprivacy`: email address, user content and audio,
   all for app functionality, no tracking.

### Review notes — draft

Paste something like this into App Store Connect, adjusting the account line:

> Demo account: `appreview@memoai.eu` / `<password>` — sign in at the "Nadaljuj z e-pošto"
> screen, or directly at https://memoai.eu/auth/password
>
> Memo AI turns lectures into notes, transcripts, flashcards and quizzes. The app records
> lectures natively (AVAudioRecorder), so recording continues when the screen is locked, and
> shows a Live Activity with elapsed time on the Lock Screen and Dynamic Island while it does.
> It also supports document and photo import, file downloads via the share sheet, offline
> handling, and `memo://` deep links.
>
> Subscriptions are not sold in the app. No purchase or payment UI is presented on iOS.

The second paragraph exists to answer Guideline 4.2 (minimum functionality) before it is asked.

### Screenshots

Capture on a 6.9" device (iPhone 17 Pro Max or similar) in the simulator:

```bash
xcrun simctl boot "iPhone 17 Pro Max"
xcrun simctl io booted screenshot shot.png
```

Apple wants 6.9" and 6.5" sets; the 6.9" set can usually be reused for 6.5". Good candidates:
the note list, a note with its summary, the recording sheet mid-recording, and the Lock Screen
Live Activity.

### Release hygiene

`main` is the single source of truth for both web and iOS — `ios/**` is outside the Next build,
so web deploys ignore it, and the [iOS workflow](../.github/workflows/ios-app.yml) only runs on
iOS changes. Tag each submission so it is always clear what shipped:

```bash
git tag ios-v1.0.0 && git push origin ios-v1.0.0
```

Bump `MARKETING_VERSION` for a user-visible release and `CURRENT_PROJECT_VERSION` for every
upload (App Store Connect rejects a duplicate build number).

Because the binary is frozen while the web keeps deploying, native capabilities are always
feature-detected — `getNativeRecorder()` returns `null` against an older web build and recording
falls back to `MediaRecorder`. Keep that pattern for anything new.

## Known limitations

- **A recording is tied to the app staying installed and not force-quit.** Native capture
  survives locking and backgrounding, but a force-quit ends it and the partial file in `tmp` is
  not recovered on next launch. Long lectures would benefit from resumable state.
- **Google sign-in depends on Google's tolerance of web views.** It works today — verified in
  the simulator against production, no `disallowed_useragent` error — because the user agent is
  Safari-shaped. Google's policy discourages embedded web views and they have tightened it
  before. The durable fix is `ASWebAuthenticationSession`, which needs a server-side handoff
  route because cookies set in that session do not reach the web view.
- **No push notifications.** There is no server-side push infrastructure to hook into yet.
