# 22 September 2026 — current verification

This section supersedes the older portal status below. **Not yet ready to
submit:** current end-to-end purchase and physical-device checks remain open.

- Integrated `origin/main` at `2603764d` into `codex/ios-app-wrapper` at
  `6256fed1`; their product trees matched. The branch Preview
  `https://memo-1nyjrhksm-nace-valencics-projects.vercel.app` is READY and uses
  the shared staging Supabase project. The user confirmed that fresh iOS
  installs must match the PWA: onboarding first, then sign-in.
- Native simulator build passed; 126 focused mobile tests and all 1,552 web
  tests passed. These checks do not prove real Apple authentication or billing.
- App Store Connect API confirms version 1.0 is READY_FOR_REVIEW in an
  **unsubmitted draft**, with VALID build **1.0.0 (8)** attached and manual
  release selected. Draft `b7aa39c6-3b7a-4e6c-a0c5-75dc3c54d2be` contains the
  app version, all four subscription versions and their subscription group.
  Its `submittedDate` is null. All 16 uploaded screenshots are COMPLETE;
  review credentials, contact and metadata are present. Content Rights is
  populated (`DOES_NOT_USE_THIRD_PARTY_CONTENT`).
- Fixed Apple's missing app-download price by configuring a free download
  with Slovenia as the base territory. Verified EUR subscription prices:
  19.99 monthly / 129.99 yearly, first-period offers 9.99 / 64.99, and
  THREE_DAYS free trials on both trial products. Review notes now explain
  onboarding before sign-in. Do not interpret the draft's READY_FOR_REVIEW
  status as proof of end-to-end testing or Apple approval.
- The signed-in App Privacy page was inspected in Arc: **Published**, with
  the policy URL `https://memoai.eu/legal/privacy-policy` and 15 declared data
  types. It is no longer an unanswered questionnaire. This observation does
  not replace checking the declarations against the implemented data flows.
- Traced the Preview's unavailable-subscriptions message to WebKit error 14:
  its host was absent from `WKAppBoundDomains`, blocking JavaScript/native
  bridge access even with the navigation restriction disabled. Native StoreKit
  returned all four products correctly. Added the build-time `MEMO_APP_BOUND_HOST`
  setting and derive app-bound navigation from the built plist. With the Preview
  host included, the iPhone displays real prices and the three-day trial CTA.
  The real-catalogue and settings tests now pass on iPhone. The wheel test also
  passes: spin, claim, select yearly and monthly, and verify 64.99 → 129.99 and
  9.99 → 19.99 in the offer cards with checkout enabled. Its US Sandbox storefront
  correctly shows dollars. Real purchase completion
  and lifecycle tests remain open; catalogue loading is not purchase validation.
- Inspected Business in App Store Connect: Paid Apps Agreement, EUR bank
  account, W-8BEN, foreign-status certificate, DSA and DAC7 all show **Active**.
  All four subscriptions have localizations and availability in 175 territories,
  including Slovenia and the US; the exact app bundle has In-App Purchase,
  Sign in with Apple and Push Notifications capabilities enabled.
- Apple's 15 September email confirms receipt of the Small Business Program
  enrollment. No approval email was found; the 15% rate is not yet confirmed.
- The updated account-switch test walks the real anonymous onboarding. It
  reached the final save and exposed missing staging schema:
  `public.onboarding_responses` returns REST 404 while `profiles` returns 200.
  The UI showed "Your answers could not be saved"; the test failed before
  staging was synchronized. The rerun passed: anonymous onboarding saves,
  Google and Apple buttons are present, and the synthetic account signs in
  by email code and reaches the home screen. Screenshots are retained in
  `review-sep22-onboarding-passed-attachments`.
  The production start route remains `/onboarding` as requested.
- Staging synchronization used a clean migration snapshot of fetched
  `origin/main` at `714fd9be` (same migration files as this branch). Dry run
  listed 0051–0054. 0051 applied; 0052 stopped because `mobile_oauth_handoffs`
  already existed without its migration-history entry. Verified the table was
  empty, its schema/functions/indexes matched main and no foreign keys or
  policies depended on it. Replayed the unchanged released 0052 SQL atomically
  after recreating those empty objects, then recorded that actual execution.
  The normal CLI subsequently applied 0053/0054. REST now verifies the
  onboarding table exists; Auth, REST and Storage return 200. No history-only
  repair, production migration or unmerged SQL was run. The other active Memo
  task was notified before and after synchronization.
- The account holder connected and unlocked their iPhone 16. Real onboarding,
  email-code sign-in, settings scrolling and light/dark/system theme selection
  passed on the phone as well as the simulator. The developer image mounts;
  the UI-test runner was signed using the existing authorized App Store Connect
  key because Xcode's local account session was unavailable.
  Device authentication, locked-screen recording and Sandbox lifecycle checks
  still require this device. Do not use another person's paired phone.
- The real staging photo study flow passed: upload, note generation, flashcards,
  quiz, mindmap, native image sharing, chat response, read-aloud playback controls,
  and note deletion. Retained screenshots were visually checked, including the
  actual chat answer. Build 8 repeated this flow on another fresh staging account
  and verified the read-aloud clock advances (captured at 0:04); the note was
  retained for the remaining study tools. An initial test stopped at the optional
  notification nudge; dismissing it through the UI allowed the flow to pass.
  Audio audibility and long playback were not verified.
- Added wrapper-only light tap and selection haptics, with trusted-event,
  disabled-control, foreground and rate-limit guards. Build **7** is installed
  on the phone; its settings click-through passes. Four native regression tests
  also pass: keyboard, document export, blob export and native error text across
  all five languages and relaunches. Physical vibration strength needs human
  perception; the simulator cannot verify it. Build 7 archived and uploaded
  successfully; Apple validated it, and it is attached to the unsubmitted draft.
  Build **8** archived, uploaded and passed Apple processing; it is now attached
  to the unsubmitted draft. It integrates `origin/main` at `890e0c0f`, including
  the native push-token removal race fix, offline shell navigation and tutor fixes.
  The 139 affected mobile/offline/tutor checks pass after integration. The
  previous full-suite result predates that integration. The screenshot gallery is at
  `ios/build/review-sep22-screenshots.md`.

- Build 8 recording passed in the dedicated simulator: native capture, pause
  with a frozen timer, resume, 15 seconds in the background, stop and delivery
  of the `.m4a` to the PWA. The take was cancelled before note generation.
  Hardware audio quality and locked-iPhone behavior remain unverified.
- Additional build 8 Simulator checks passed: memory-palace generation, 3D
  rendering, movement and exit; speed-reader playback advances and pause holds
  its position. These do not prove every game interaction or device performance.
  Podcast generation and playback also pass, with its playback position
  advancing eight seconds before pausing. A fresh iPad install completes
  Slovenian onboarding and synthetic email login; portrait/landscape notes,
  flashcards and settings checks pass. The wider layout uses the PWA rail.
- Repeated practice-test starts exposed a real shared PWA race: the start
  action unlocked before the new attempt finished loading, creating two
  attempts and reopening the leftover attempt after grading. A synchronous
  lock now covers both the POST and detail refresh. All 55 practice-test checks
  pass, including delayed-refresh, same-render repeat taps and retry coverage.
  Real Preview verification also passes on commit `12c05d21`: one fresh
  attempt was created and graded, with no extra in-progress attempt in staging.
  The earlier leftover draft was completed through the UI, without deleting
  or rewriting attempt rows. The iPad screenshot capture now uses the screen
  to avoid XCTest's stale portrait crop after rotation.
- Preview `https://memo-ei25tuep1-nace-valencics-projects.vercel.app` is READY
  (`dpl_FpBMduGqEfMAksx7XP69w5nwVfXM`, `12c05d21`). Its current environment
  was checked against the shared staging project. Type checking passes after
  regenerating route types and moving obsolete local generated types aside;
  focused ESLint also passes. These changes have not been merged to production.
- The 22 September email check found the Small Business enrollment receipt of
  15 September, but no approval email. The reduced commission is unconfirmed.
- The real iPhone Sandbox checkout now reaches Apple’s account/password dialog.
  It has not completed a transaction; the inspection test is explicitly skipped,
  not counted as a purchase pass. The user has been asked to authenticate with
  a Sandbox tester directly on the phone.

Evidence is in ignored `ios/build/review-sep22-*` artifacts. The primary local
`main` was clean and matched fetched `origin/main` at `2603764d` when checked;
this alone does not verify the live production deployment.

# Earlier release-readiness evidence

## 20 September 2026 — App Review compliance sweep

A full pass over the wrapper, the project configuration and the App Store
Connect record against Apple's review requirements. What the sweep changed:

| Item | Before | Now |
| --- | --- | --- |
| Privacy manifest, required-reason APIs | Declared `NSPrivacyAccessedAPICategoryUserDefaults` only. `LectureRecorder.stop()` calls `FileManager.attributesOfItem(atPath:)` for the take's byte count, which is on Apple's required-reason list whatever attribute is read — an undeclared use comes back as **ITMS-91053** after upload. | `NSPrivacyAccessedAPICategoryFileTimestamp` declared with reason `C617.1` (metadata of a file in the app's own container). Verified in the built bundle's `PrivacyInfo.xcprivacy`. |
| Recordings and iCloud backup | The `Recordings` folder sat in Application Support with no backup flag, so a take waiting to upload — up to ~43 MB for a three-hour lecture — would go into the user's iCloud backup, against Apple's data-storage guidelines. | The folder is created with `isExcludedFromBackup`. |

Verified unchanged and correct (no action needed):

- **3.1.1 / 3.1.3(b):** no Stripe path is reachable under the native user
  agent. `/api/billing/*` navigations are cancelled in the wrapper, the
  Stripe checkout and billing hosts are refused even on a user tap, and all
  60 `tests/mobile-*.test.mjs` guards pass.
- **3.1.2:** the paywall states the plan, period and price from StoreKit's own
  `displayPrice`, carries "Renews automatically until cancelled in your Apple
  subscription settings", and has Restore purchases, terms of use and privacy
  policy next to the buy button. Settings also has Restore and Manage Apple
  subscriptions. The App Store description repeats the full renewal wording.
- **4.8:** Sign in with Apple is offered alongside Google and e-mail, and
  account deletion revokes the Apple grant (`revokeAppleAccountGrants`).
- **5.1.1(v):** account deletion is in Settings, in-app, and the sheet says
  deletion does not cancel an Apple subscription.
- **5.1.1 / 5.1.2:** microphone, camera and photo-library purpose strings are
  present and localized into all five shipped languages; the AI-processing
  consent gate is explicit and withdrawable.
- **2.1 / 2.3:** icon is 1024×1024 with no alpha; launch screen present;
  `ITSAppUsesNonExemptEncryption=false`; `audio` background mode is genuinely
  used by the recorder and the session is deactivated on stop; the privacy
  manifest, all five `.lproj` folders and the Live Activity extension are in
  the built bundle; `xcodebuild`'s `-validate-for-store` pass succeeds.
- App Store Connect record: age rating answered (4+), categories set
  (Education / Productivity), support, marketing and privacy-policy URLs all
  answer 200, review contact and demo account saved, review notes describe the
  code sign-in, the purchases and the deletion path, all four subscriptions at
  group level 1 and READY_TO_SUBMIT with review screenshots COMPLETE.

Still open, and not fixable from here:

1. **App Privacy questionnaire** — still unanswered, and there is no API for
   it. Derive it from `ios/MemoAI/PrivacyInfo.xcprivacy`; never "Data Not
   Collected".
2. **Attach the four subscriptions to version 1.0** — browser only.
3. **Content Rights declaration** is `null` on the app record. It must be
   answered before the version can be submitted, and it is the account
   holder's declaration to make.
4. **Version 1.0 still has build 1 attached.** Builds 2–4 are uploaded and
   VALID; `CURRENT_PROJECT_VERSION` is 5 and has not been archived. Build 1
   predates the native recorder, the Lock Screen banner and offline mode, so
   it is the wrong binary to submit and also understates the app's native
   surface against guideline 4.2.
5. **Device checks** (microphone, tutor, Sandbox purchase lifecycle, restore,
   Manage Apple subscriptions, locked-screen recording) are still unrun.

Prices: Apple bills every customer in their own storefront currency. The
subscriptions are 19.99 / 129.99 in each territory checked, which is **€19.99
and €129.99 in Slovenia, Croatia and Germany** and $19.99 / $129.99 on the US
storefront. There is no setting that shows euros to a US buyer; the only lever
is restricting availability to euro territories. Dollar prices seen while
testing come from the simulator's US storefront, which is a known gotcha —
`ios/MemoAIUITests/Offers.storekit` is already pinned to `_storefront: SVN`.

## 18 September 2026

| Check | Result |
| --- | --- |
| Review account | `apple-review@memoai.eu` created in production, onboarded, on `APPLE_SANDBOX_REVIEW_USER_IDS`; signs in on production (verified by HTTP) and in the iPhone 17 Pro Max and iPad Pro 13" simulators; holds one generated note ("Plant Life Cycle", synthetic) with flashcards and a quiz. After PR #421 it signs in with the fixed code (`APP_REVIEW_LOGIN_CODE`), verified on the branch preview under the native user agent. |
| Sandbox server notification | `requestTestNotification` → `https://www.memoai.eu/api/mobile/notifications`: SUCCESS. |
| App Store Connect | Four subscriptions at level 1, READY_TO_SUBMIT, each with a review screenshot; USD prices aligned ($19.99 / $129.99, offers $9.99 / $64.99) and visible in the simulator paywall; age rating answered; 6 + 6 + 4 screenshots (iPhone 6.9", 6.5", iPad 13") COMPLETE; review contact, demo account and notes saved; build 1.0.0 (1) attached to version 1.0. Privacy questionnaire and the version's subscription attachment still need the account holder in the browser. |
| Separation contract | Caught on the iPad simulator: the app's paywall showed "Secure payment through Stripe" while StoreKit was still loading. Fixed in PR #421 (`native.securePayment`), guarded by `tests/mobile-paywall-parity.test.mjs`. 48 mobile tests and the full suite (1,365) pass. |
| Still not verified | Everything that needs the physical iPhone: microphone/tutor, native Google and Apple sign-in round trips, Sandbox purchases, Manage Apple subscriptions, account deletion end to end. |


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
- App Store Connect API: access approved; team keys `DL79AMQY5C` (App Manager) and `M2VD53GP68` (Admin, required for cloud-managed distribution signing); issuer `6715f045-a181-4ad1-b072-5824a5bf1220`. Private keys live in `~/.config/memoai/apple/` (a symlink in `~/.appstoreconnect/private_keys/` serves altool). `scripts/apple/asc-builds.mjs` lists builds.
- **Build 1.0.0 (1) exported with cloud signing, validated (no errors) and uploaded to App Store Connect on 17 September 2026** (delivery `c3d6b52d-00ed-49fd-983f-b6d5c312d8dd`). Export compliance is answered by `ITSAppUsesNonExemptEncryption=false` in Info.plist.
- Build 1 processed (`VALID`) and is `IN_BETA_TESTING` for the internal TestFlight group **Memo internal** (`c60398fa-…`, access to all builds); the account holder is invited (accept the TestFlight e-mail, then install from the TestFlight app). `scripts/apple/asc-api.mjs` makes ad-hoc App Store Connect API calls.
- Still open: install from TestFlight and run the device checks (microphone/tutor, native Apple and Google sign-in, Sandbox purchases, Manage Apple subscriptions); a completed web Apple sign-in on a real Apple Account; screenshots, age rating and review notes in App Store Connect; the submission itself.

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
