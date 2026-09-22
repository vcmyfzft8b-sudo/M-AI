# Memo AI iOS — release handoff (updated 22 September 2026)

Current evidence is at the top of `ios/AppStore/release-readiness.md`.

- The user confirmed **PWA onboarding first**, then Google/Apple/email sign-in.
- App Privacy is published. Content Rights is populated. Build **1.0.0 (9)**
  is attached. The download price is free.
- Draft submission `b7aa39c6-3b7a-4e6c-a0c5-75dc3c54d2be` contains version
  1.0, all four subscriptions and their group. **It is not submitted.**
- Slovenia prices are verified: €19.99 / €129.99, first-period offers
  €9.99 / €64.99, and three-day trials on the trial products.
- Staging was missing migrations 0051–0054. It now has all four released
  migrations, with Auth, REST and Storage health checks passing. 0052's
  existing empty objects were replayed atomically using the unchanged released
  SQL before recording its real execution; no migration repair or production
  migration was used.
- Real onboarding and email-code sign-in passed after staging synchronization;
  both Google and Apple buttons are present. The photo study workflow passed,
  including notes, flashcards, quiz, mindmap/export, chat and deletion. Physical
  iPhone onboarding, email login and settings tests also pass.
- Build 7 adds wrapper-only haptics and is installed on the iPhone. Build **8** is now VALID and attached to the unsubmitted draft,
  including the released push-token sign-out fix from `origin/main` at `890e0c0f`.
  All 139 affected mobile/offline/tutor checks pass. Simulator native recording
  also passes start/pause/resume/background/stop; physical audio remains open.
- Additional simulator passes: memory palace generation/movement, speed reader,
  podcast generation/playback, and iPad onboarding/login/rotated study/settings.
- Fixed a shared PWA race that allowed duplicate practice-test attempts while
  the new attempt loaded. 55 practice checks and the real Preview flow pass:
  one fresh attempt was created and graded, with no duplicate left in progress.
  Preview `memo-ei25tuep1-nace-valencics-projects.vercel.app` is READY at
  `12c05d21`, using staging; production has not received this branch fix.
- Portrait-only is now required on iPhone and iPad. Build 9 rotation checks
  pass on both simulators. Build 9 is VALID, attached to the unsubmitted draft,
  and installed on the iPhone. Physical launch was blocked by the locked phone.
- Synthetic account deletion passed in the UI and blocks access. Final cleanup
  is due after its three-hour drain, at 17:04:40 local time on 22 September.
- Build 9 also passes actual note generation from a public web article, on a
  new synthetic staging account. The completed Water Cycle note is captured
  in the screenshot gallery; `review-sep22-public-article-final.xcresult` passes.
- AI-permission withdrawal, persistence after relaunch, and explicit re-consent
  pass in the actual app (`review-sep22-consent-withdrawal-verified.xcresult`).
- PDF import through the native Files picker and actual circuit-note generation
  pass (`review-sep22-pdf-import-picker.xcresult`). The committed PDF fixture
  and its setup are documented in `docs/ios-app.md`.
- Device tests pass for real Apple product loading, three-day trial display,
  the wheel and both half-off offer cards, and settings/theme controls.
- Preview catalogue loading is fixed: the Preview host must be included with
  `MEMO_APP_BOUND_HOST` at build time so WebKit allows the native bridge.
- Current release gates: complete Google/Apple authentication and Sandbox lifecycle checks on the account
  holder's iPhone. Business agreement, bank, tax and EU compliance are all Active.
- Do not control Arc: the user needs to use the Mac uninterrupted. Use APIs
  and the dedicated `Memo wrapper QA` simulator. Ask for a limited UI handoff
  only if a remaining Apple setting cannot be handled in the background.

The dated evidence below is historical; the current section above supersedes
its build, privacy, migration and PR status.

Read this before `docs/ios-app.md` (setup reference) and `ios/AppStore/release-readiness.md` (evidence log).

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
