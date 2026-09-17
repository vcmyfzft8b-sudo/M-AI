# iOS release readiness — 16 September 2026 (afternoon update)

**Not ready for App Review or production activation.** This is the release gate,
not a claim that compiling or passing the wrapper tests verifies the whole app.
Everything below the evidence table needs the account holder: Apple portal
sessions, the connected iPhone, Sandbox credentials, or the production merge.

## Verified today (branch `codex/ios-app-wrapper`, Preview deployments of `d793285a`/`f20e995f`)

| Check | Result |
| --- | --- |
| Web suite, TypeScript, ESLint | 1,344 web tests pass (two files need the branch's `jose` and `@apple/app-store-server-library` installed); `tsc --noEmit` and lint clean. |
| Native fixture suite | `npm run ios:test` passes the six wrapper tests on iPhone and iPad (iOS 26.5). `StoreOfferTests` still fails from the command line with `SKInternalErrorDomain Code=3`; it passes in the Xcode IDE (known Xcode 26.5 limitation). |
| Real study flow in the wrapper | `testPreviewCreateStudyNoteFromPhoto` **passes end to end** on the staging Preview (evening run): a seeded lesson photo became "The Plant Life Cycle" with highlights in about 80 s; flashcards (11 cards), a 12-question quiz and a mindmap were generated; "Save as image" opened the native share sheet with Copy / Save Image (the reason for the new photo-library string); the chat answered "Summarise the lecture"; read-aloud started playing; the note was deleted and staging holds no lectures for the account afterwards. Right after deletion the home list can still show the note for a moment (client router cache) — cosmetic. Recording, tutor and podcast still need a physical iPhone (microphone) and are not automated. |
| Sign-in screen in the app | Fresh iPhone 17 Pro Max simulator, signed out: Google, Apple and email all render, the back arrow to the (non-existent) landing page is gone, and a password login with a synthetic staging account reaches the AI-consent gate. |
| Click-through tour | `testPreviewTour` on the signed-in simulator captured home, search keyboard (no accessory bar), the discount wheel spin and Apple offer sheet, the paywall from home and from New note, the note with every tab (tutor, flashcards, podcast, quiz, mindmap, palace, practice test, speed reader, transcript), the actions/rename/delete sheets, chat, read-aloud and settings (theme, language, help, redeem, privacy, share, feature, plan, restore, manage, withdraw consent, delete account, sign out). Fixes that came out of it: flashcard controls under the chat bar, offer-sheet footer on the home indicator, bars lowered to the home-indicator line, the wheel button's crossfaded label, and WebKit scrolling a sheet's header off the top when the keyboard opens (the web view now keeps a non-scrollable document at rest). |
| Settings rows | `testPreviewSettingsRows`: Suggest a feature, the settings paywall, Restore purchases (raises Apple's sandbox sign-in prompt on the simulator, as expected), Withdraw AI permission (now behind a confirmation sheet; it used to take effect on a single tap and lock the account out of AI features), Delete account (sheet carries the "does not cancel Apple subscriptions" warning), Sign out and Share Memo all open and dismiss. "Manage Apple subscriptions" opens Apple's own sheet, which on the simulator becomes an Apple Account sign-in; verify it on a device with a Sandbox account. |
| Edge-to-edge layout | The web view now fills the window; the page is served `viewport-fit=cover` for the native user agent and lays out with `--memo-safe-top/bottom`. Home, paywall, note and settings were reviewed by screenshot; the paywall close button and the native consent/support screens were re-inset after the first review. |
| App Review guideline audit (web side) | Stripe Checkout, Billing Portal and tutor-credit routes refuse the native user agent before any work (now covered by `tests/mobile-billing-guards.test.mjs`); every paywall, upsell and settings surface routes to StoreKit; existing Stripe subscribers see their plan with a "managed where purchased" line and no portal; account deletion is in-app with the Apple-subscription warning; email login is code-based and never leaves the web view; external links open in Safari; `/support` exists. Remaining copy notes are listed under "Known, accepted" below. |
| Keyboard and layout polish | WKWebView's previous/next/done bar above the keyboard is removed (the content view answers `inputAccessoryView` with nil; fixture screenshot verified). The wrapper upgrades the viewport meta to `viewport-fit=cover` itself when a page arrives without it, so an app pointed at production before this branch ships still lays out under the status bar correctly. The Apple paywall shows one short renewal line plus restore/terms/privacy links instead of a four-line paragraph, so it lands on one viewport like the web paywall. |
| Native fixes | `NSPhotoLibraryAddUsageDescription` added in five languages (the share sheet's "Save Image" would otherwise terminate the app); script-started `mailto:`/`tel:` links (Settings → Share Memo) reach the system; the tutor's microphone-denied message points at iOS Settings; the project generator matches the checked-in Info.plist and privacy manifest. |
| Release archive | A fresh signed Release archive of the final branch state (`ios/build/MemoAI-release.xcarchive`, also copied to `~/Library/Developer/Xcode/Archives/2026-09-16/` so it appears in Xcode's Organizer) builds with the photo-library string, edge-to-edge view, accessory-bar and keyboard fixes. **Command-line export still fails with "No Accounts"** even after the Apple ID was added in Xcode → Settings → Accounts: `xcodebuild -exportArchive` cannot see the account session from this shell, and the only API key on disk is the Sign in with Apple key, not an App Store Connect API key. Export from Organizer (Distribute App → App Store Connect) or create an App Store Connect API key for `-authenticationKeyPath`. |

Previous evidence (screenshots `ios/build/screenshots/01`–`15`, earlier result bundles) still stands; see the sections below.

## Verified implementation and evidence

| Requirement | Evidence and scope |
| --- | --- |
| Use the actual PWA screens | Shared `OnboardingPaywall`, `DiscountOffer` and `SettingsScreen`; no separate native replacement paywall. Actual staging walkthrough covered email login, consent, 23 onboarding steps, home, paywall, wheel and settings. Generated-content flows remain below. |
| Keep current PWA fixes | Merged freshly fetched `origin/main` through `222b7382`, including the tutor sample-rate fix. Three audio regression tests pass in `ios/build/upstream-audio-tests.log`. TypeScript and web build pass in `release-parity-types.log` and `release-parity-web.log`. |
| No browser controls over Memo | Root WKWebView has no address bar/tabs; embedded Safari sheets and link previews removed. Branch-only Vercel preview toolbar disabled. `browser-free-final.xcresult` passes against Preview `6afed733`; actual home and light/dark settings screenshots have no preview toolbar. |
| Scrollable PWA settings | Actual Preview XCTest selects Light/Dark/System and scrolls to Language, Restore and Manage Apple subscriptions. This does not prove a completed restore transaction. |
| Apple-specific billing help | Actual Preview `4bedf420` help walkthrough passes in `native-help-final.xcresult`: Settings → Redeem a code displays Apple-specific instructions without Stripe Checkout directions. Screenshot captured; this does not implement discount-code redemption. |
| Open login, not marketing | `AppConfiguration.startURL` is `/auth/continue`; actual signed-out simulator launch showed login. Signed-in launch resumes the account. |
| Google, Apple and email choices | Actual login screenshot shows all three. Email/password login completed on a synthetic staging account. Real Google and Apple completion remain unverified. |
| Match PWA locale rules | Existing IP-country policy: SI/sl, HR/hr, BA/bs, RS/sr, otherwise/en; saved user preference wins. Locale tests and native language/relaunch UI test passed. Not GPS-based. |
| Correct Apple prices and trial | App Store Connect saved Slovenia base prices: €19.99/month, €129.99/year; first-period offers €9.99/€64.99; separate three-day trial products at the same renewal prices. Other storefronts use Apple's localized prices. Presentation/eligibility tests pass; purchases do not yet. |
| Native build | Latest signed archive including browser changes: `ios/build/MemoAI-browser-free.xcarchive`; `browser-free-archive.log` reports success. Distribution re-export remains required. |
| Privacy manifest | App-only theme storage declares UserDefaults reason `CA92.1`. Manifest covers account, purchases, content, support, usage, diagnostics and coarse location; App Store questionnaire is not yet complete. |

Screenshots under `ios/build/screenshots/`: `12-full-screen-home.png`,
`13-full-screen-settings-light.png`, `14-full-screen-settings-dark.png`,
`15-full-screen-settings-apple.png`. These show synthetic staging data, not a
release build connected to production. Test results and artifacts are local and
ignored by Git.

## Production configuration done on 17 September 2026

- Vercel Production: `APPLE_SIGN_IN_ENABLED`, `NATIVE_GOOGLE_SIGN_IN_ENABLED`, `APPLE_IAP_ENABLED` and `APPLE_WEB_SIGN_IN_ENABLED` are `true`; both Apple private keys and the IAP issuer/key ids are set. Production serves Google, Apple and email on the native login; the web login now also shows Continue with Apple.
- Production Supabase: Apple provider enabled with client ids `eu.memoai.memo,eu.memoai.web` and a six-month client secret generated on 17 September 2026 (rotate before 16 March 2027 with `scripts/apple/web-client-secret.mjs`); the native Google callback `eu.memoai.memo.auth://google/callback**` is on the redirect allowlist.
- Apple Developer: Services ID `eu.memoai.web` (Sign in with Apple, primary App ID `eu.memoai.memo`, domains memoai.eu, www.memoai.eu and both Supabase hosts, return URLs both Supabase callbacks).
- App Store Connect: production and sandbox server-notification URLs are `https://www.memoai.eu/api/mobile/notifications` (the apex host answers a POST with a 307 redirect, so the www host is required).
- Still open: App Store Connect API access (needed for the command-line export/upload; `ios/Config/ExportOptionsUpload.plist` is ready), a completed web and native Apple sign-in on a real Apple Account, Sandbox purchases on a device.

## Required before calling the app ready

1. **Real authentication:** complete Google and Apple sign-in on the connected
   iPhone; confirm session resume, account association, sign-out and Apple
   authorization revocation during account deletion.
2. **Apple Sandbox lifecycle:** complete trial and discounted monthly/yearly
   purchases, verify server entitlement delivery, same-account restore,
   wrong-account rejection, renewal/expiry, cancellation, refund/revocation,
   pending purchases and interrupted/offline delivery. The Sandbox tester's
   email is verified; no transaction has completed. Prior authentication
   failures are not successful billing coverage.
3. **Subscription configuration:** put all four products at the same service
   level; configure and test server notifications against staging. Repeat the
   production configuration only as part of an authorized production release.
4. **Discount codes:** create and test Apple-compatible equivalents of the
   actual Stripe codes. Native help now explains the available Apple offers
   instead of directing iOS users to Stripe; this does not implement code
   redemption. Before enabling Apple's
   redemption sheet, securely associate tokenless external redemptions with a
   Memo account without permitting purchase theft or account reassignment.
   Existing strict `appAccountToken` verification intentionally rejects such
   unassociated transactions.
5. **Actual study flows:** the photo → note → flashcards path is verified in the
   simulator (see the table above); recording, text and link input, palace,
   podcast and tutor are not. Onboarding demonstrations and wrapper fixtures do
   not prove those flows. Test real microphone/camera, interruptions and audio
   on the iPhone, and the actual app layout on iPad. Decide/configure Apple purchase support for any
   paid voice-credit feature currently hidden from native users.
6. **Apple metadata:** complete privacy and age-rating questionnaires from the
   deployed implementation; capture the required iPhone/iPad marketing and
   subscription-review screenshots; prepare and validate a dedicated review
   login and accurate review notes. The draft is `ios/AppStore/metadata.md`.
7. **Business approvals:** last portal verification showed banking, Paid Apps,
   W-8BEN, foreign-status certificate and DAC7 Active. EU trader was In Review;
   Small Business enrollment was submitted without an approval receipt. Do not
   state that the 15% commission is approved until Apple confirms it.
8. **Release deployment and binary:** after Preview checks, obtain the required
   merge/production authorization; deploy the branch's ordered migrations via
   the main-branch workflow; configure production Apple auth/billing securely;
   verify production and the Release build together; export/validate/upload the
   final signed binary and complete TestFlight checks. No main merge, production
   activation, build upload, App Review submission or public release has occurred
   in this task.

## Production configuration (17 September 2026)

- Vercel production holds `APPLE_APP_ID`, `APPLE_BUNDLE_ID`, `APPLE_IAP_*`, `APPLE_SIGN_IN_*` and a fresh `APPLE_AUTH_TOKEN_ENCRYPTION_KEY`; `APPLE_SIGN_IN_ENABLED`, `NATIVE_GOOGLE_SIGN_IN_ENABLED`, `APPLE_IAP_ENABLED` and `APPLE_WEB_SIGN_IN_ENABLED` are `true`. Production was redeployed; the app's login on `memoai.eu` shows Google, Apple and email, the web login gained "Continue with Apple" and is otherwise unchanged.
- Production Supabase: Apple provider enabled with client IDs `eu.memoai.web,eu.memoai.memo` (the web Services ID first, because Supabase sends the first one to Apple's authorize endpoint) and a six-month client secret from `scripts/apple/web-client-secret.mjs` (rotate before **March 2027**); `eu.memoai.memo.auth://google/callback**` added to the redirect allowlist.
- Apple Developer: Services ID `eu.memoai.web` ("Memo AI web sign in") with Sign in with Apple, primary App ID `eu.memoai.memo`, domains `memoai.eu`, `www.memoai.eu` and both Supabase hosts, return URLs `https://<project>.supabase.co/auth/v1/callback` for production and staging.
- Web "Continue with Apple" reaches Apple's sign-in page with `client_id=eu.memoai.web`; completing it with a real Apple Account is the remaining check.
- Still pending in App Store Connect: the server-notifications URLs (`https://www.memoai.eu/api/mobile/notifications` — the bare domain 307-redirects and Apple does not follow redirects), App Store Connect API access (needed for a command-line export/upload), the four products at one service level, screenshots and review notes.

## Current operational blockers

- **Export needs Xcode's Organizer or an App Store Connect API key.** The
  Apple ID is signed in to Xcode, but `xcodebuild -exportArchive` from a
  terminal still reports "No Accounts" / no "iOS Distribution" certificate.
  The archive is in Organizer; validate and distribute it there, or create an
  App Store Connect API key (Users and Access → Integrations → App Store
  Connect API) and pass it with `-authenticationKeyPath`.
- **Prices in the simulator are Apple's US storefront** ("$17.99", "$119.99")
  because it has no Apple Account; attaching the local StoreKit configuration
  to the preview scheme stops the app loading under UI tests, so it stays
  detached. On a Slovenian Apple Account the cards read €19.99 and €129.99,
  the App Store Connect prices.
- **No physical iPhone is connected** (both registered devices show
  `unavailable`), so microphone recording, the tutor, Apple/Google sign-in
  completion and Sandbox purchases remain unverified on hardware.
- **Sign in with Apple in production** depends on `APPLE_SIGN_IN_*` and
  `APPLE_AUTH_TOKEN_ENCRYPTION_KEY` being set there; if they are missing the
  Apple button silently disappears while Google stays, which App Review
  rejects under guideline 4.8. Verify on production before the first upload.

## Known, accepted for the first submission

- Apple prices are Apple's: the plan cards show StoreKit's localized price for
  the buyer's storefront (€19.99/month and €129.99/year on a Slovenian Apple
  Account, the nearest Apple price points to the web's €20/€130). The
  simulator has no Apple Account and shows the US storefront ("$17.99",
  "$119.99"); that is not a bug in the page and cannot be overridden.

- The in-app terms and refund articles still describe the web channel
  ("Stripe portal", "pricing page") alongside the App Store instructions they
  lead with. They are legal text, not purchase calls to action; the how-to
  articles (redeem a code, gifting) are rewritten for the app.
- Settings offers "Manage Apple subscriptions" to accounts without an Apple
  subscription (useful after a purchase that has not been delivered yet); a
  Stripe subscriber sees it next to the "managed where purchased" line.
- Tapping a legal link leaves the app shell for the public legal page; swipe
  back or the logo returns to the app.
- `testPreviewCreateStudyNoteFromPhoto` spends the synthetic account's one free
  note; a full re-run needs a fresh synthetic staging account.

## Sources for Apple-specific behavior

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [App privacy details, including embedded web views](https://developer.apple.com/app-store/app-privacy-details/)
- [Offer-code integration](https://developer.apple.com/documentation/storekit/supporting-offer-codes-in-your-app)
- [App account token association](https://developer.apple.com/documentation/appstoreserverapi/set-app-account-token)
- [Vercel preview-toolbar configuration](https://vercel.com/docs/vercel-toolbar/managing-toolbar)

These references guide implementation; they do not establish Apple's approval
of Memo or replace the unresolved end-to-end checks above.
