# Memo AI iOS — release handoff (updated 23 September 2026)

The current evidence and unresolved gates are in
[release-readiness.md](release-readiness.md). **Not ready for App Review submission.**

## Current state

- The wrapper shares the PWA onboarding, study tools, settings and design.
  Only platform billing, provider authentication and native device functions differ.
- Release **1.0.0 (11)** is archived, exported and validated by Apple locally.
  It includes keyboard bridge v4. It has **not been uploaded**. The unsubmitted
  App Review draft still contains build 9, version 1.0, four subscriptions and
  their group. Release is manual.
- The test branch `codex/ios-app-wrapper` is pushed at `a8f29b9d`. Its READY
  Preview is `https://memo-f3876ro3o-nace-valencics-projects.vercel.app`, using
  shared staging. The branch's changes are not a production deployment.
- Actual app coverage includes photo/PDF/Word/slides/web-article note generation,
  flashcards, quiz/practice, mindmap/export, memory palace, speed reader,
  podcast/read-aloud, chats, settings, consent and keyboard handling. See the
  dated evidence for each test's scope; this is not blanket hardware validation.
- Native Apple and Google sign-in passed on the physical iPhone. A real Sandbox
  yearly trial purchase, restore and access after restart passed on the
  synthetic Word account. No entitlement or quota was fabricated.
- Slovenia products show €19.99/month and €129.99/year; eligible first periods
  show €9.99 and €64.99. The separate trial products offer three days free.
- Paid/Free Apps Agreements, bank, tax, EU trader status and DAC7 are Active.
  All 15 App Privacy types were reconciled and published. Small Business Program
  enrollment is submitted; approval of the 15% rate is unconfirmed.
- A second synthetic UI deletion is queued for its unchanged three-hour drain
  at **04:06:24 CEST on 23 September**. Verify the live waiter's completion and
  independent Auth, Storage, note and analytics inventory before marking it done.

## Remaining release gates

1. Confirm final erasure; test actual Sign in with Apple token revocation.
2. Finish dedicated Sandbox lifecycle checks: accelerated renewal, expiry,
   refund/revocation and other products. The new dedicated tester was not created.
3. Complete physical audio quality, locked-screen/interruption and spoken-tutor
   checks. UI playback/recording evidence alone does not verify these.
4. Obtain the owner's third-party Content Rights confirmation, then correct the
   current `DOES_NOT_USE_THIRD_PARTY_CONTENT` declaration. Imported documents and
   web pages make that current declaration inaccurate; do not infer licensing.
5. Resolve matching discount codes without weakening account ownership checks.
   Current Apple introductory offers work; equivalent code redemption is absent.
6. Verify final screenshots/metadata and the final production web deployment
   against the signed release, then TestFlight. Obtain merge/release authorization
   before changing production, and submit only after these gates pass.

Use CLI/API and isolated simulator/XCTest runs so the owner can use the Mac.
Do not take over Arc's shared cursor without a necessary, limited handoff.
Do not promise Apple acceptance or claim the app can suppress iPadOS window controls.

## Historical notes

The sections below are dated history, **not current setup instructions**. They
include superseded builds, resolved gates and old account requirements. Use the
current section and `release-readiness.md` to decide the next action.

## Where things stand (18 September 2026, evening)

- `main` runs the wrapper-aware web app; the iOS project is in `ios/`. **PR #421** (`fix/ios-web-parity-auth-wheel`) is open and must be merged before submission: it removes the password screen (the review notes already describe the code flow it introduces), drops the auth header logo, fixes the wheel button crossfade, makes the app's wheel once a day, preloads the brand images, and stops the app's paywall naming Stripe while StoreKit loads.
- Production is configured (Apple flags, keys, Supabase Apple provider, `APPLE_SANDBOX_REVIEW_USER_IDS` = review account + device-QA account + the account holder's Apple-created account, `APP_REVIEW_ACCOUNT_EMAILS` / `APP_REVIEW_LOGIN_CODE`). Apple's Sandbox test notification reaches `https://www.memoai.eu/api/mobile/notifications` (SUCCESS on 18 September).
- App Store Connect, done through the API on 18 September: all four subscriptions at **group level 1** and **READY_TO_SUBMIT** (review screenshot on each); USD prices $19.99 / $129.99 with first-period offers $9.99 / $64.99 (Apple has no $20 / $130 points; other storefronts keep Apple's equalised prices; Slovenia €19.99 / €129.99, €9.99 / €64.99); age rating answered (no flagged content, no web access, no UGC); screenshots uploaded for iPhone 6.9" (`APP_IPHONE_67`, 6 shots), 6.5" (6) and iPad 13" (4) from the review account's synthetic "Plant Life Cycle" note; review contact, demo account (`apple-review@memoai.eu` + fixed code) and review notes saved; build **1.0.0 (1)** attached to version 1.0 (manual release).
- **Build 1.0.0 (2)** (uploaded 19 September, VALID, in the internal TestFlight group) adds sign-in failure reasons: a failed Google/Apple sign-in shows "Sign-in could not be completed" plus, in brackets, the failing step (provider error, callback mismatch, browser error, or server status). It also makes the Google browser session ephemeral (no "wants to use supabase.co" prompt). The account holder's native Google sign-in failed twice on 18 September after choosing the account, with no callback POST reaching `/api/mobile/google-auth`; the bracketed reason from build 2 is the next clue. Nothing has been submitted for App Review; the account holder wants to test more first.
- Since PR #426 the e-mail steps carry the back arrow on both platforms, the auth card cannot overflow at large text sizes, and the AI-consent gate is an auth card with loading states.
- **Lectures now record with the phone locked.** Capture is native (`ios/MemoAI/LectureRecorder.swift`, `audio` background mode) and a Live Activity shows the Memo lockup and a running clock on the Lock Screen. This adds the project's **first app extension**, `RecordingLiveActivity`, on the already-registered identifier `eu.memoai.memo.RecordingLiveActivity` — nothing to register at Apple, but the archive now needs a distribution profile for it as well as for the app, and the next build must be uploaded before the locked-screen check below can be done on a device. See "Lecture recording and the Lock Screen banner" in `docs/ios-app.md`.

## Note notifications (added 20 September 2026)

The app can now tell a reader their note is finished after they have put the
phone down. Everything is built and tested except the one piece Apple will not
let anything but a human create.

**What you have to do, once:** Apple Developer portal → Certificates,
Identifiers & Profiles → **Keys** → **+** → name it `Memo push` → tick **Apple
Push Notifications service (APNs)** → Continue → Register → **Download**. Apple
allows that download exactly once. Put the `.p8` in
`~/.config/memoai/apple/` and note the 10-character Key ID from the filename.
There is no App Store Connect API for this — `/v1/keys` and every neighbouring
path 404, and `POST /v1/certificates` accepts eighteen certificate types, none
of them APNs. The Push Notifications capability on the App ID *was* automatable
and is already enabled.

**Then set in Vercel production** (and staging, to exercise it on a preview):

| Variable | Value |
| --- | --- |
| `APPLE_PUSH_ENABLED` | `true` |
| `APPLE_PUSH_KEY_ID` | the 10-character Key ID |
| `APPLE_PUSH_PRIVATE_KEY` | the `.p8` contents, newlines as `\n` |
| `APPLE_PUSH_TEAM_ID` | optional; falls back to `APPLE_SIGN_IN_TEAM_ID` |

Every native path stays behind `APPLE_PUSH_ENABLED`, which defaults off, so a
deployment without the key behaves exactly as before: the endpoint answers 503,
the queue is never read, and the prompt never appears.

**How it works.** A database trigger (migration `0053`) writes a `push_queue`
row whenever a lecture's status settles to `ready` or `failed` — a trigger
rather than a call site, for the same reason `mark_trial_consumed_on_ready` is
one: `ready` is written from three places today and will be written from more.
`deliverPendingPushNotifications()` drains the queue, and is called by the
pipeline that just finished a note as well as hourly by `/api/cron/push-queue`
as a net. The app asks for permission at the only moment the question answers
itself — while a note is generating and the reader is watching the progress —
because iOS grants exactly one prompt per install.

**Still to check on a device** once the key is in: the prompt appears on a
first note, the token reaches `push_devices`, locking the phone and waiting out
a note produces a banner, tapping it opens that note, and signing out removes
the row so the next account on that phone is not notified.

## Remaining work, in order

1. Re-run real Preview onboarding and the synthetic study workflow; no production
   accounts or data in Preview. Finish settings, recording, offline and keyboard
   checks on the dedicated simulator and retain screenshots.
2. On the account holder's connected iPhone, verify native Google and Apple sign-in,
   microphone/tutor, recording while locked, Sandbox purchases, restore, expiry,
   cancellation, Apple subscription management and synthetic-account deletion.
   Authentication must be completed by the account holder when required.
3. Review the final screenshots and privacy declarations against the final app.
   If native code changes after build 6, bump both targets' shared build number,
   archive/upload a new build and replace the draft's attached build.
4. Submit the assembled draft only after release gates pass and submission is
   authorized. Keep manual release selected. Apple's READY_FOR_REVIEW status
   does not mean tests passed or the app is approved.
5. Small Business Program enrollment receipt is confirmed by Apple's 15 September
   email; approval and the 15% rate remain unconfirmed. EU trader status is Active.
6. Rotate the Supabase Apple client secret before **16 March 2027**
   (`node scripts/apple/web-client-secret.mjs eu.memoai.web`).

## The separation contract (do not break it)

The web app must behave exactly as before for browsers; the app must never show Stripe.

- **Detection:** the wrapper sets the user agent suffix `MemoAI-iOS/1.0`. Server code uses `isNativeUserAgent()` (`src/lib/mobile/runtime.ts`); client code uses `useNativeIOS()` / `isNativeIOS()` (`src/lib/mobile/client.ts`); CSS uses `html[data-native]`, set by the root layout only for that user agent. Presentation only: never authorize by user agent.
- **Billing:** `/api/billing/checkout`, `/api/billing/portal`, `/api/billing/tutor-credits` return `403 native_purchase_required` to the app; the app's paywalls call StoreKit through `useAppleBilling` and the server verifies transactions in `/api/mobile/transactions`. Browsers never see `useAppleBilling`, "Restore purchases", "Manage Apple subscriptions" or the Apple terms line. An Apple subscriber who logs in on the web has paid access (`hasPaidAccess` includes the Apple entitlement) and sees an Apple management link instead of the Stripe portal — that is intended.
- **Sign-in:** Google inside the app goes through `ASWebAuthenticationSession` and `/api/mobile/google-auth`; Apple inside the app uses the native ID token via `/api/mobile/apple-auth`; the web uses Supabase OAuth for both. The web Apple button is gated by `APPLE_WEB_SIGN_IN_ENABLED`. E-mail sign-in is by code on both, with no password screen; the review and QA accounts in `APP_REVIEW_ACCOUNT_EMAILS` accept the fixed `APP_REVIEW_LOGIN_CODE` and are never mailed.
- **Parity:** everything else is the same product on both — see "Web And iOS App Parity" in `AGENTS.md`. The wheel is once a day on both (the app records its spin on the same profile column).
- **Guards:** `tests/mobile-billing-guards.test.mjs`, `tests/mobile-paywall-parity.test.mjs`, `tests/mobile-auth-options.test.mjs` and the rest of `tests/mobile-*.test.mjs` fail if a Stripe path opens for the app or an Apple path leaks to the web. Keep them green. New web features that touch billing, login, the install guide or the home dock must be checked with both user agents (`curl -A "... MemoAI-iOS/1.0"` against a preview is enough).
- **Safe-by-default flags:** every native path is also behind an env flag that defaults off, so a preview without the flags behaves like the plain web app.

## Commands and tooling

- Archive: `xcodebuild -project ios/MemoAI.xcodeproj -scheme MemoAI -configuration Release -destination generic/platform=iOS -derivedDataPath ios/build-archive -archivePath ios/build/MemoAI-release.xcarchive -allowProvisioningUpdates archive`
- Export (cloud signing needs the **Admin** key; an App Manager key fails with "Cloud signing permission error"): `xcodebuild -exportArchive -archivePath ios/build/MemoAI-release.xcarchive -exportOptionsPlist ios/Config/ExportOptions.plist -exportPath ios/build/export-release -allowProvisioningUpdates -authenticationKeyPath ~/.config/memoai/apple/AuthKey_M2VD53GP68.p8 -authenticationKeyID M2VD53GP68 -authenticationKeyIssuerID 6715f045-a181-4ad1-b072-5824a5bf1220`
- Validate / upload: `xcrun altool --validate-app|--upload-app -f ios/build/export-release/MemoAI.ipa -t ios --apiKey M2VD53GP68 --apiIssuer 6715f045-a181-4ad1-b072-5824a5bf1220` (altool reads the key from `~/.appstoreconnect/private_keys/`, symlinked).
- Builds and any App Store Connect API call: `node scripts/apple/asc-builds.mjs`, `node scripts/apple/asc-api.mjs GET /v1/...`. The API also moves group levels (`PATCH /v1/subscriptions/{id}` with `groupLevel`), sets prices (`POST /v1/subscriptionPrices`, price-point ids from `/pricePoints?filter[territory]=…`, paged), answers the age rating (`PATCH /v1/ageRatingDeclarations/{appInfoId}`, needs `ageAssurance:false`), saves review details and uploads screenshots (upload operations + `uploaded:true` with an MD5).
- Simulator QA against the staging preview: the ignored "MemoAI Preview QA" scheme, the signed-in simulator and the synthetic account are described in `docs/ios-app.md` and the memory note; run `xcodebuild … -scheme "MemoAI Preview QA" … -only-testing:MemoAIUITests/WrapperTests/<test> test` with the QA simulator UDID.
- Private material lives only in `~/.config/memoai/apple/` (IAP key, Sign in with Apple key, both API keys, `server.env`, `review-account.env`, `device-qa-account.env`). Never commit it or paste it into chat.
- Simulator screenshots for the store: `ios/build/screens/` and `ios/build/appstore/` (ignored). Typing into the Simulator: CGEvent unicode typing is broken (every character arrives as `a`); paste via `xcrun simctl pbcopy` + ⌘V, or hardware key codes. Seed a note for a synthetic production account with `POST /api/lectures/manual` then multipart `POST /api/lectures/scan` with `lectureId`.

## Gotchas already paid for

- The apex host `memoai.eu` answers a POST with a 307 to `www`; Apple's notification client will not follow it, so every server URL uses `https://www.memoai.eu/…`.
- Attaching `Offers.storekit` to the preview scheme stops the app loading under UI tests; the simulator therefore shows the US storefront. Real prices (€19.99 / €129.99) come from App Store Connect and appear on a Slovenian Apple Account.
- A tap in the UI tests before React hydrates is lost; the preview tests retry.
- The synthetic account's free note is one-shot; the study-flow test reopens the note it created.
