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

**Worth wiring up on the web side:** the onboarding paywall has an "add to home screen" step
(`src/components/onboarding-paywall.tsx`) that makes no sense inside the app. Gating it on
`data-memo-native` would remove a confusing step for every app user.

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
anyone. Set your team in Xcode's Signing & Capabilities tab, and register the bundle ID
`eu.memoai.app`.

Then work through these, in order of how likely they are to cost you a rejection:

1. **Payments — Guideline 3.1.1.** The paywall sends users to Stripe Checkout
   (`src/app/api/billing/checkout/route.ts`). Selling access to app features through anything
   other than In-App Purchase is rejected, and "it's a web view" is not an exemption. Either
   gate the purchase UI behind `data-memo-native` and sell only outside the app, or implement
   StoreKit. **This is the blocker to resolve first** — it is not something the wrapper can fix.
2. **Minimum functionality — Guideline 4.2.** A pure web wrapper is explicitly called out. The
   native recording, share, download, offline and deep-link behaviour here is the argument
   against that; be ready to make it in the review notes. Adding push notifications or native
   audio capture would strengthen it considerably.
3. **Sign-in credentials.** Give App Review a working account in the review notes. Without one
   they see only the sign-in screen.
4. **Privacy answers.** `MemoWeb/Resources/PrivacyInfo.xcprivacy` declares email, user content
   and audio, collected for app functionality, no tracking. The App Store Connect privacy
   questionnaire must match what the *web app* actually collects.
5. **Account deletion — Guideline 5.1.1(v).** Apps with account creation must offer in-app
   account deletion. Confirm the web app has it.

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
