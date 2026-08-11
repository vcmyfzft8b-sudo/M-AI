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
- iOS 16.0 or newer, iPhone only, portrait only

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

## Configuration

The target URL lives in `Support/Info.plist` under `MemoBaseURL`. Debug builds can be pointed
elsewhere without editing anything — add a launch argument in the scheme:

```
-MemoBaseURL https://your-branch-preview.vercel.app
```

Debug builds also allow `*.vercel.app` in the navigation policy so a preview deployment renders
in-app; Release builds do not.

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

- **Recording stops when the screen locks.** iOS suspends the web content process on lock and
  ends the microphone track, silently truncating a long lecture. `UIBackgroundModes: audio`
  keeps text-to-speech playing but does not fix capture. The only real fix is native capture
  (`AVAudioRecorder`) with a bridge to the upload endpoint.
- **Google sign-in depends on Google's tolerance of web views.** It works today — verified in
  the simulator against production, no `disallowed_useragent` error — because the user agent is
  Safari-shaped. Google's policy discourages embedded web views and they have tightened it
  before. The durable fix is `ASWebAuthenticationSession`, which needs a server-side handoff
  route because cookies set in that session do not reach the web view.
- **No push notifications.** There is no server-side push infrastructure to hook into yet.
