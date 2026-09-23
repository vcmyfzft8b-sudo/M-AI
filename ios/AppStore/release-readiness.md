# 23 September 2026 — current verification

This section supersedes the older portal status below. **Not yet ready to
submit:** current end-to-end purchase and physical-device checks remain open.

## Discount codes — 23 September, local implementation

- A read-only Stripe catalogue audit found 24 active unrestricted codes sharing
  `memo50-first-cycle` (50%, once), plus older recurring/gift campaigns. No
  customer records or payments were read or modified. The private inventory is
  `review-sep23-stripe-code-terms.json`; it is not a client-side code allowlist.
- Created `memo_code_half_month` and `memo_code_half_year` on the existing paid
  monthly/yearly Apple subscriptions. Each copies the exact current introductory
  price points in all 175 storefronts. Fresh read-back verifies every territory
  and price point, including €/$9.99 and €/$64.99 in Slovenia/USA. Existing base
  prices, three-day trials and introductory offers are unchanged.
  `scripts/apple/half-off-offers.mjs` defaults to read-only planning/verification;
  `--apply` only creates missing offers and refuses an existing mismatch.
- The new authenticated `/api/mobile/promotions` checks the live code/coupon at
  display and purchase time. Unsupported changed terms, caps, customer limits,
  disabled/expired codes and active membership fail closed. Returning subscribers
  need their own verified Apple transaction history in an allowed environment.
  Signatures bind product, offer, user UUID and a fresh nonce using Apple's SDK;
  the receipt verifier's account-token checks are unchanged.
- Bridge v5 supplies actual StoreKit prices and uses Apple's signed promotional
  purchase option. New subscribers use the existing intro instead. Settings →
  Redeem a code has localized copy in all five languages and the same design
  tokens as Settings; browsers retain their existing web help/checkout.
- The native simulator build, TypeScript and lint pass. The full suite passes
  **1,622 tests**, including cryptographic account/product/offer binding and
  altered-code rejection. Headless light/dark and browser/native-UA checks pass
  against the local server with real catalogue validation and **simulated**
  StoreKit prices (`review-sep23-code-local-browser.json`). These do not establish
  a completed Apple purchase. Actual StoreKit UI verification is still running.
- Uploaded build 11 still has bridge v4. This work needs a new binary, Preview
  verification and the authorized production release. Actual promotional
  purchase/restore, code attribution in creator reporting, and recurring/gift
  campaigns remain outside the completed evidence. Do not claim submission-ready.


## Remaining submission gates

- Complete Apple account-deletion revocation. Apple and Google sign-in and
  subsequent session recovery now pass on the physical iPhone against staging;
  repeat authentication on the final production/TestFlight build before release.
- Complete accelerated Sandbox renewal, expiry and refund/revocation tests.
  A real yearly trial purchase, server entitlement delivery, Restore Purchases
  and access after app restart now pass on the physical iPhone. Other product
  purchases and the final TestFlight environment remain to be checked.
- Finish hardware recording/audio/interruptions and the other explicitly listed
  device checks. The portrait lock and email-code/settings walkthrough pass on
  the connected iPhone; perceived haptics and audio quality remain unverified.
- Repeat account/file erasure on the final deployed release. Staging deletion
  and analytics cleanup passed after the unchanged three-hour drain; actual
  Apple authorization revocation remains part of the authentication gate.
- Obtain the owner's Content Rights confirmation and correct Apple's declaration
  for imported third-party documents/web pages. Reconcile final screenshots with
  the release implementation. The [privacy reconciliation](privacy-reconciliation.md)
  now records the completed comparison of all 15 portal data types and the
  published User ID purpose/Product Interaction linkage corrections. Verify the
  final production deployment preserves these audited data flows.
- Resolve the optional discount-code request without weakening transaction
  ownership checks. Equivalent Stripe codes are not implemented on Apple.
- Account for the iPadOS windowing limit: portrait layout is verified, but
  `UIRequiresFullScreen` cannot force exclusive full-screen presentation in
  iPadOS 26 Windowed Apps or Stage Manager. The system can show a resize handle
  and scale the app. Do not claim that these system controls are browser chrome
  or that the app can suppress them.
- Obtain production merge/release authorization, verify the deployed web app
  with the signed Release binary, and complete TestFlight checks before review
  submission. Build 11 is available for internal TestFlight testing; the unsubmitted
  review draft still contains build 9. Neither is a production deployment of
  this branch or an App Review submission.

Apple's Small Business enrollment is submitted, but its 15% approval remains
unconfirmed. Apple controls review acceptance; these checks cannot guarantee it.

## Verified work and evidence

- The final whole-repository test run passes **1,612 tests, zero failures and
  zero skips** (`review-sep23-release-full-tests-final.log`, 29.3 seconds).
  The first full run found one stale source assertion expecting the offline
  shell to use its pre-localization URL directly. The corrected assertion
  checks that the localized URL is constructed from the same-origin public
  shell and is still fetched with `credentials: "omit"`. Executable worker
  tests independently verify that behavior in all five locales. Runtime code
  was not changed to satisfy the stale assertion. This suite supplements the
  actual wrapper/Preview evidence; it does not replace remaining hardware,
  real purchase lifecycle or owner-attestation checks.

- Microphone denial now explains how to enable access instead of exposing a
  technical bridge/browser error. iOS uses the existing localized Settings
  instructions; browsers get localized recording instructions in all five
  catalogues. TypeScript, focused lint and 99 mobile/recorder/locale regressions
  pass. Actual rendered local and READY `eb62bb1a` Preview checks pass under
  both user agents; native-UA browser checks simulate the bridge denial and
  are not a substitute for the real app. The actual Simulator permission was
  revoked through simctl: `review-sep23-microphone-sim.xcresult` passes one test
  (105.7 seconds) with the native recorder, correct recovery copy, released busy
  state and successful dismissal. Microphone permission was restored afterward.
  Screenshot: `review-sep23-microphone-sim-attachments/C6FBF487-6208-4300-871E-737DE08CE216.png`.
  The first deployed browser harness clicked New note before hydration; the
  final run waits for the source picker and keeps all denial assertions.
  Logs: `review-sep23-microphone-{local-browser-final,preview-final}.log`.

- A read-only Apple Server API check at 04:18 CEST independently verified the
  synthetic Word account's Sandbox subscription and renewal signatures. Apple
  reports the yearly trial active with auto-renew on, matching the staging
  ledger exactly. Its first expiration is **23 September at 23:58:04 CEST**;
  the latest transaction is still `PURCHASE`, not `RENEWAL`. This confirms
  current ownership/entitlement consistency, not renewal, refund or expiry
  coverage. Evidence: `review-sep23-sandbox-lifecycle-current.json`.

- Full quiz testing found a scoring defect: the delayed automatic advance used
  the render from before the final answer, so a correct last answer was counted
  as missed. Even a one-question retry could repeat indefinitely. The real
  Preview reached retry round 23 (`review-sep23-quiz-repeat-loop-baseline.json`).
  The callback now carries its updated answers into round scoring. Executing
  the component's actual handlers with render-snapshot semantics reproduces two
  failures on the old source and passes all four regressions after the fix.
  TypeScript, focused lint and 113 mobile, keyboard, locale and study regressions
  pass. Local real-component completion/restart checks pass with browser and
  native user agents. READY Preview `memo-35hsi0jd2-nace-valencics-projects.vercel.app`
  at runtime commit `9afd7b14` also completes/restarts the quiz; an independent
  authenticated API read verifies the reset after the normal five-second save.
  The physical iPhone passes wrong-answer feedback, all 13 generated questions,
  full process restart/recovery, exactly one missed-question retry, 100%
  completion and restart: `review-sep23-iphone-quiz-round-final.xcresult`
  (1 pass, 125.2 seconds). Four screenshots are retained; the final completion
  capture was visually inspected. The generated-quiz screen check separately
  passes in `review-sep23-iphone-quiz-generation-final.xcresult` (38.3 seconds).
  Earlier harness attempts waited for an intentionally hidden eyebrow, scrolled
  an already visible answer, or closed a browser before its five-second save.
  The final checks use the visible counter, measured dock boundary and persisted
  setup state; those earlier failures are not counted as passes.
- Quiz "See why" also hardcoded its user message in Slovenian. The selected
  language now supplies that message through all five catalogues. An actual
  Preview request reproduced the Slovenian message in an English-selected app
  (`review-sep23-quiz-chat-baseline.json`). Local browser/native checks now send
  the English message, receive a completed real chat response and show no page
  errors (`review-sep23-quiz-chat-local-{browser,native}.json`). The physical iPhone
  chat handoff passes in `review-sep23-iphone-quiz-chat-final.xcresult` (41.1
  seconds), with the full English message visible in chat. The first attempt
  hit XCTest's 128-character identifier limit; matching the full label with a
  predicate fixes the harness without truncating the assertion.
- Inspecting that saved chat found a separate ordering defect: each inserted
  question/answer pair shares its database timestamp, so timestamp-only reads
  sometimes returned the assistant before the user. This affected both reopened
  chat and the history supplied to the tutor. Both reads now break timestamp ties
  by role, with inverse ordering for the reverse-chronological history query.
  The actual reversed pair is retained in `review-sep23-chat-order-baseline.json`.
  All five saved pairs now appear in the right order in both the local API and
  rendered browser/native-UA chat (`review-sep23-chat-order-local-{browser,native}.json`).
  TypeScript, focused lint and 40 chat/tutor tests pass, including three order
  regressions. READY Preview `memo-hez4o32lx-nace-valencics-projects.vercel.app`
  at runtime commit `5fadfe40` passes server and rendered ordering under both
  user agents (`review-sep23-chat-order-preview-browser.json` and
  `review-sep23-chat-order-preview-native-final.json`), with no page errors.
  The physical iPhone quiz/chat handoff also passes on this Preview:
  `review-sep23-iphone-quiz-chat-ordered.xcresult` (41.2 seconds); its screenshot
  shows the English question followed by its relevant answer. An earlier
  native-UA harness run timed out on the intermediate library title before
  reaching chat. The final run navigates directly to the authenticated note
  and retains every server/UI ordering assertion.
- Physical iPhone flashcard generation and editing now have dedicated coverage.
  The circuit note generated 13 cards through the ordinary app action. The
  editor test adds a manual card, selects/replaces its answer through iOS's
  editing menu, saves, fully relaunches Memo, verifies the exact updated answer,
  swipes to reveal Delete and removes the test card. The answer field stays above
  the keyboard. `review-sep23-iphone-flashcard-edit-final.xcresult` passes one
  test in 104.9 seconds; four screenshots are retained. An independent
  authenticated API read confirms all 13 generated cards remain, no manual QA
  card remains, and the study asset is ready
  (`review-sep23-flashcard-final-server.json`). Earlier attempts exposed test
  assumptions about the mobile edit label, off-screen fields, text selection
  and WebKit's hit-testing of a revealed swipe action. Those harness issues
  were corrected; the final run uses visible control coordinates, native
  Select All, real app requests and persisted content. Failed-run manual cards
  were cleaned through the authenticated API; generated cards were preserved.
- Offline cold-launch testing found two shared defects: the new native
  `/onboarding` entry was missing from the offline route map, and anonymous
  shell fetching re-detected IP language despite recording the selected locale.
  A real cached Preview navigation reproduced the missing-library screen in
  Slovenian for an English-selected account (`review-sep23-offline-entry-baseline.json`).
  `/onboarding` now opens the cached library; shell requests pass a validated
  locale while continuing to omit account cookies. Online onboarding is unchanged.
  A production-mode local build and 139 offline/mobile regressions pass, including
  the actual native start path and all five supported shell locales.
  The real simulator test uses a one-day local TLS certificate trusted only in
  the dedicated QA simulator and a task-only proxy to staging-backed local code.
  After caching the library/note, the proxy closes and rejects app-origin traffic.
  Full app termination/relaunch, saved library/note reading, Tutor/Podcast offline
  explanations, reconnection and the normal creation menu all pass:
  `review-sep23-offline-native-retry.xcresult` (1 pass, 182.6 seconds).
  Proxy counters stay at 396 between disconnect and reconnect; these are actual
  cached WKWebView screens, not replacement UI. This isolates app-origin loss,
  rather than changing the Mac network or claiming a physical airplane-mode test.
  The initial native attempt was stopped before offline testing because the TLS
  proxy's forwarded origin failed onboarding's same-origin check. Correcting the
  test proxy resolved it without weakening the application check.
  Deployed verification also passes on READY Preview
  `memo-f9uh04fts-nace-valencics-projects.vercel.app` at `72429edb`:
  browser and native user agents both navigate through the real service worker
  to the saved library/note while offline, retain English, and recover online
  with no page errors (`review-sep23-offline-entry-preview-browser.log` and
  `review-sep23-offline-entry-preview-native.log`). Anonymous shell requests for
  all five supported locales return the matching HTML language under both user
  agents (`review-sep23-offline-preview-locales.json`). These deployed checks use
  headless Chromium; the simulator evidence above separately verifies WKWebView.
- A real Preview walkthrough reproduced paused podcast seeking restarting audio
  when the target crossed a speaker-turn boundary. The shared player now
  preserves playback intent, invalidates superseded loads on Pause/Close, and
  persists seeks at the end of the gesture. Local browser and native-UA checks
  cross from 0 to 20,439 ms and independently read that position back from the
  staging server. Resume advances; normal playback crosses the first turn with
  exactly one audio element playing. Delayed real segment responses remain
  paused after Pause and cannot restart playback after Close. Only latency is
  simulated in those race checks; authentication, component and audio are real.
  Evidence: `review-sep23-podcast-seek-paused-cross-segment-repro.json`,
  `review-sep23-podcast-seek-local-browser-persisted.json`,
  `review-sep23-podcast-seek-local-native-handoff-from-start.log`, and
  `review-sep23-podcast-seek-local-pending-{pause,close}.json`.
  TypeScript, focused lint and 116 podcast/mobile regression tests pass.
  A Preview persistence check exposed overlapping responses. The test now waits
  for the initial reset acknowledgement before the seek. A separate deterministic
  regression reproduced an actual save-order race: a slow older save overwrote
  the newer position. Per-episode save ordering fixes it; pending positions are
  buffered immediately and older acknowledgements cannot clear newer entries.
  The two new regression tests, TypeScript, lint and 118 focused tests pass;
  the real local browser also persists and resumes the sought position.
  The READY `07b2db41` Preview is
  `https://memo-mxif3n1a0-nace-valencics-projects.vercel.app`. The real browser
  check confirms request/server/slider agree at 20,340 ms and verifies normal
  segment handoff (`review-sep23-podcast-seek-preview-queue-diagnostic.log`).
  An initial Preview walkthrough timed out before opening Podcast; the repeated
  walkthrough passes without page errors.
  Physical iPhone cross-turn seek/pause/resume now passes:
  `review-sep23-iphone-podcast-seek-retry.xcresult` (1 pass, 75.5 seconds).
  Screenshots show the paused sought position and successful resumed playback.
  These checks verify transport and progress, not perceived audio quality.
  The first physical attempt was stopped because its Play-only starting-state
  assumption could not handle an already autoplaying cached episode; the test
  now explicitly pauses before checking playback.
- The keyboard coverage audit found onboarding's practice-answer footer still
  pinned behind the keyboard. It now uses the same shared inset on both PWA
  and wrapper, with a single scrollable step and a footer that follows each
  frame without a second CSS animation. The real simulator keyboard test
  checks typing, visible answer/Continue, then dismissal:
  `review-sep23-onboarding-keyboard-local.xcresult` (1 pass, 36.4 seconds).
  Browser fallback geometry also passes at 375 × 667 with a simulated viewport
  change; this is layout evidence, not a hardware frame-rate measurement.
  The earlier library/note-chat, search, rename and shared-sheet results still
  cover those unchanged surfaces. TypeScript, focused lint and 96 mobile/sheet
  regressions pass. Two initial simulator attempts were harness failures:
  the filtered Preview scheme selected zero tests, then an origin override
  containing `/onboarding` was rejected and opened the published page. The
  final run uses the unfiltered scheme and an origin-only local override.
  The READY `058c4eb1` Preview is
  `https://memo-7elesth2r-nace-valencics-projects.vercel.app`. Both browser and
  native-UA checks pass there: footer bottom equals keyboard top, with the
  answer visible, at 375 × 667 and 393 × 852 respectively. Reports:
  `review-sep23-onboarding-keyboard-preview-browser.json` and
  `review-sep23-onboarding-keyboard-preview-native.json`. These Preview checks
  simulate the keyboard geometry; the simulator result above uses UIKit.
- Recording returned from actual Siri on the iPhone and continued advancing;
  the retained capture shows active recording, not the optional paused branch.
  The same test then backgrounds the app, returns, stops to an M4A capture and
  cancels without creating a note. Evidence:
  `review-sep23-iphone-siri-recording.xcresult` (1 pass, 193.4 seconds).
  Audible continuity, incoming-call and locked-screen tests remain separate.

- Physical iPhone podcast generation/playback now passes with the circuit note:
  progress advances, Pause stays stopped, and Back 10 seconds seeks backward.
  `review-sep23-iphone-podcast-controls.xcresult` passes in 60.5 seconds. The first
  attempt passed playback/pause but XCTest could not operate WebKit's range
  input through its native scrubber API; the rerun uses the app's real seek
  button. The server confirms one ready 12-turn episode and generated audio
  segments (`review-sep23-iphone-audio-server.json`). The playback screenshot
  was visually inspected; audible quality is still a separate hardware check.
- A stronger read-aloud test found invisible mobile dock layers exposed duplicate
  Pause controls to accessibility. Tapping the hidden control's reported center
  did not pause playback. Inactive idle/player/annotation layers now use `inert`
  and `aria-hidden`, retaining their visual crossfade and leaving only active
  controls available to assistive technology and keyboard navigation.
  Local real-component checks pass for browser/native user agents: one accessible
  control, stable pause, advancing resume and close back to Listen. TypeScript,
  focused lint and 125 mobile/TTS regressions pass. Evidence:
  `review-sep23-dock-local-results.json`, `review-sep23-dock-accessibility-types.log`,
  `review-sep23-dock-lint.log`, `review-sep23-dock-tests.log`. Preview and physical
  iPhone verification were pending at push time. The READY Preview is now
  `memo-4qmi5o27p-nace-valencics-projects.vercel.app` at `2105262e`. Physical
  iPhone retesting passes in 42.2 seconds, asserting one accessible Pause
  control, stable pause, advancing resume and close back to Listen:
  `review-sep23-iphone-read-aloud-fixed.xcresult`. Its two screenshots were
  retained; the resumed playback capture was visually inspected. Browser and
  native-UA Preview checks also pass (`review-sep23-dock-preview-results.json`),
  including actual advancing audio, pause, resume and close. The first headless
  Preview run timed out waiting for Pause after an early click; the rerun allows
  the dock to finish client setup before clicking. The first native test failure
  from an unsupported XCTest predicate was a harness error, separately fixed
  before the duplicate-control failure was reproduced and corrected.

- Physical iPhone live tutor controls now pass on the current Preview. The real
  circuit note reached Explaining, stayed Paused, resumed Explaining, and ended
  back at Start. `review-sep23-iphone-live-tutor-signedin.xcresult` passes one
  test in 49.9 seconds; four captures are retained in
  `review-sep23-iphone-tutor-attachments/`. Explaining and Paused were visually
  inspected. An independent staging read confirms the new 1,800-second grant
  settled at **12 seconds**, not the entire reservation
  (`review-sep23-iphone-tutor-grants.json`). This does not verify spoken questions,
  interruption handling or audible quality. The first run stopped at sign-in
  before starting a session; the synthetic Word account was then restored
  through the ordinary email-code UI (`review-sep23-iphone-tutor-signin.xcresult`).

- The build 11 web Preview at `memo-f3876ro3o-nace-valencics-projects.vercel.app`
  is READY at `a8f29b9d`. Deletion-confirmation layout and sign-in navigation
  pass there for browser/native user agents in light/dark. All four variants
  have centered text and no horizontal overflow; the native dark capture was
  visually inspected. Evidence: `review-sep23-deletion-preview-layout.json`
  and `review-sep23-deletion-preview-native-dark.png`. The shared keyboard and
  mobile regression suites also pass all 96 checks.
- Offer-code feasibility was checked against Apple's current documentation and
  the installed iOS 26.5 SDK. Its UIKit redemption API accepts a window scene,
  without account-token options. Apple's newer `presentOfferCodeRedeemSheet`
  overload taking `RedeemOption` is documented for iOS 27, outside this toolchain.
  This is not proof of a safe ownership-binding solution for supported OS
  versions. The current server's verified `appAccountToken` requirement remains
  intact; no unowned transaction claiming or code redemption was enabled.
  Sources: [Apple offer codes](https://developer.apple.com/documentation/storekit/supporting-offer-codes-in-your-app)
  and [UIKit redemption options](https://developer.apple.com/documentation/storekit/appstore/presentoffercoderedeemsheet(from:options:)-89agc).

- Release build **11** includes native keyboard bridge v4 and ProMotion support.
  Archive/export and Apple `altool` validation all pass on 23 September. Local
  package checks verify matching app/widget versions, distribution signature,
  disabled debugging, production APNs, Apple sign-in, phone/tablet portrait,
  production origins, absence of the Debug URL override and the corrected
  privacy manifest. Evidence: `review-sep23-build11-archive.log`,
  `review-sep23-build11-export.log`, `review-sep23-build11-verification.json`,
  `review-sep23-build11-apple-validation.json`. Export:
  `ios/build/export-release-11/MemoAI.ipa`; SHA-256
  `9bb6f15dabd09af7b3446c0681496e45739913c126b2501b5cf820582d9c7744`.
  **Uploaded, not submitted for App Review.** Upload succeeded without errors
  at 04:14 CEST on 23 September; delivery ID
  `e5980c8c-e9ca-4621-9a30-50a7aae2cf09`. The IPA checksum and strict signature
  were verified again immediately before upload. Evidence:
  `review-sep23-build11-upload.json`. Apple subsequently reports **VALID**,
  `APP_STORE_ELIGIBLE`, no non-exempt encryption, and **IN_BETA_TESTING**.
  Independent group membership lists build 11 in **Memo internal**. English
  testing notes were saved as beta localization
  `823d6172-dcd0-46e4-b288-03845b2b8ed4`, explicitly noting that this binary
  opens production while the web fixes remain on the test branch. Evidence:
  `review-sep23-build11-delivery-status.json`. Matching production web deployment
  and final TestFlight checks remain required; this supersedes build 10 packaging.
- A second actual-wrapper deletion run now uses the synthetic Slides account
  (`ios-slides-20260922@example.com`) on staging. Preparation, real analytics
  opt-in/relaunch/withdrawal and deletion each pass:
  `review-sep23-erasure-prepare.xcresult`, `review-sep23-erasure-analytics.xcresult`,
  `review-sep23-erasure-delete.xcresult` (deletion: one pass, 25.2 seconds).
  Before deletion there was one note, one 17,011-byte file, two owned analytics
  sessions and 22 page views. The UI confirms deletion requested; the server
  independently confirms access blocked and the unmodified cleanup deadline
  **23 September, 04:06:24 CEST**. The purchased Word QA account remains intact.
  Cleanup completed at **04:06:37 CEST** against the audited immutable Preview:
  one deletion, zero failures. Independent inventory confirms the Auth account,
  note, storage file, both analytics sessions, all 22 page views and the queued
  job are gone. Captured analytics IDs also rule out orphaned rows. The unrelated
  Word account still owns its note. Evidence: `review-sep23-erasure-complete.json`
  and `review-sep23-erasure-inventory-{before,queued,after}.json`. This verifies
  staging erasure of an email-review account, not Apple grant revocation or
  production deletion.
- The deletion confirmation screenshot exposed an uncentered Sign in link.
  Reusing `memo-auth-submit` fixes it in both the PWA and wrapper. Local browser
  and native-user-agent checks pass in light/dark, with centered text, no
  horizontal overflow and successful navigation to sign-in. The native-UA
  screenshot was visually inspected; it is a development capture, not an App
  Store asset. Focused lint and all 84 `mobile-*.test.mjs` checks pass.
- On 23 September (00:58 CEST), the signed-in App Store Connect Business page
  shows Paid Apps Agreement, Free Apps Agreement, the Revolut EUR payout account
  ending 4320, W-8BEN, Certificate of Foreign Status, Digital Services Act and
  DAC7 all **Active**. This resolves the earlier request to check Business;
  it does not establish Small Business Program approval.
- App Privacy's 15 published types, purposes, linkage and tracking were compared
  with the current native manifest. User ID lacked Analytics, and Product
  Interaction had an unlinked declaration despite account-linked visit records.
  Corrected and published both; the final detail preview now lists all 15 under
  Data Linked to You, with no unlinked or tracking section. See the exact table
  in `privacy-reconciliation.md`. The review draft still selects build 9 and
  does not contain the latest native fixes; no review submission was made.
- The physical iPhone recorder now passes with the genuinely purchased
  entitlement: start, pause (timer stays paused), resume, 15 seconds in the
  background, return with elapsed time preserved, and stop to a 24-second M4A
  ready screen. The capture was then cancelled without creating another note.
  `review-sep23-iphone-recording-premium.xcresult`: one pass, 190.5 seconds.
  The final screenshot was visually inspected and the five captures are in
  `review-sep23-iphone-recording-attachments/`. This confirms the recording UI
  and background continuity on real hardware; audible quality, a locked-screen
  capture and telephone/Siri interruptions have not been verified by this run.
- At 21:58:04 UTC on 22 September, the physical iPhone completed Apple's actual
  no-charge Sandbox checkout for `eu.memoai.premium.trial.yearly`. The owner
  confirmed the physical side-button/Face ID step. Apple's sheet displayed
  three days free followed by **€129.99/year**. Memo returned home and its server
  persisted a verified, active Sandbox entitlement for the synthetic Word QA
  account, expiring at 21:58:04 UTC on 23 September. This test-environment expiry
  is not the production trial duration. Evidence:
  `review-sep22-iphone-sandbox-confirm.xcresult` (one pass, 146.2 seconds),
  `review-sep22-billing-purchase-verified.json` and
  `review-sep22-iphone-purchase-success.png`. The earlier handoff-only run
  skipped while the Subscribe sheet was still awaiting confirmation.
- Restore Purchases then passed through the actual Settings row, followed by
  an app restart with **Apple subscription active** still visible.
  `review-sep22-iphone-restore-purchased.xcresult`: one pass, 64.2 seconds.
  The same entitlement was re-verified at 21:59:53 UTC, independently confirmed
  by `review-sep22-billing-restore-check.json`. All three Settings screenshots
  are retained in `review-sep22-iphone-restore-attachments/`; the post-relaunch
  capture was visually inspected. No subscription rows or quota values were
  fabricated for either test.
- The new dedicated Sandbox tester has not yet been created. A read-only
  `/v2/sandboxTesters` check at midnight confirms only the September 16 tester
  exists (`review-sep23-sandbox-testers.json`). The successful purchase sheet
  used the owner's ordinary Apple account in Apple's no-charge test environment.
  Its verified Sandbox receipt is valid purchase evidence, but it does not
  provide the dedicated tester's accelerated lifecycle controls.
- The owner reports successful Apple sign-in on the connected iPhone with
  Debug build 10 against the staging Preview. A read-only staging check confirms
  an `apple_auth_grants` record for `eu.memoai.memo`, updated at 21:19:09 UTC
  on 22 September (`review-sep22-device-apple-grant-confirmation.json`). This
  confirms grant persistence. The later device test also recovered the Apple
  session after relaunch, opened Settings, signed out and opened Google.
- Google authentication completed on the physical iPhone at 21:38:09 UTC.
  The real Google system-browser page returned to Memo home; XCTest passed in
  75.5 seconds (`review-sep22-device-google-live.xcresult`). Staging's Auth API
  independently confirms the Google identity and sign-in timestamp in
  `review-sep22-device-provider-session-confirmation.json`. The subsequent
  synthetic-account preparation test relaunched Memo, recovered this Google
  session, opened Settings and signed out. Both provider screenshots were
  inspected: the app's home screen uses the shared PWA layout with no browser
  toolbar. Google's separate system authentication sheet retains system chrome.
  These are staging results; Apple revocation and final TestFlight verification
  remain open.
- The physical iPhone subsequently completed the synthetic Word QA account's
  email-code login (`review-sep22-iphone-billing-account.xcresult`: one pass,
  135.5 seconds). That fixture has consumed its free note and has no Apple
  entitlement, independently confirmed in `review-sep22-billing-before.json`.
  Its recorder test correctly encountered the upgrade screen when opening a
  second note, so **no hardware recording pass** is claimed from
  `review-sep22-iphone-recording.xcresult`. The screenshot shows the real US
  catalogue, three-day trial, $19.99/month and $129.99/year renewal terms, and
  working-layout restore/terms/privacy controls. Retest capture after a real
  Sandbox purchase unlocks the account; the fixture's allowance was not reset.
- The opt-in `testPreviewGoogleSignInHandoff` test builds successfully and is
  prepared to recover the existing session, sign out through Settings, verify
  both provider buttons, and open Google authentication. Physical-device runs
  at 23:27 and 23:28 CEST both failed before executing the test: XCTest timed
  out while enabling automation mode despite CoreDevice reporting the iPhone
  unlocked. Evidence: `review-sep22-device-google-handoff.log` and
  `review-sep22-device-google-retry.log`. No Google sign-in or session-recovery
  pass was claimed from those attempts. After the owner enabled automation,
  the 23:34 run navigated onboarding but lost its CoreDevice connection.
  The 23:37 retry completed successfully as recorded above. The handoff test
  now also saves screenshots in its own test-runner container so a connection
  failure does not lose all visual evidence. The Sandbox tester form separately
  awaits owner-entered credentials.
- Release build 10 is archived and exported locally with the current native
  restore fix and corrected User ID Analytics declaration. Apple `altool`
  validation returned **VERIFY SUCCEEDED with no errors** at 23:16 CEST on
  22 September. The exported IPA's signature, app/extension version match,
  disabled debugging, production APNs entitlement, Apple sign-in entitlement
  and phone/tablet portrait declarations were checked. Its Release executable
  contains the production origins and omits the Debug preview override.
  Evidence: `review-sep22-build10-archive.log`, `review-sep22-build10-export.log`,
  `review-sep22-build10-verification.json` and
  `review-sep22-build10-apple-validation.json` in `ios/build/`. Package:
  `ios/build/export-release-10/MemoAI.ipa`, SHA-256
  `b0b5009a03edc3bde547c2aa7243ed04e665c910e0e710254b275e19723cb2e8`.
  Build 10 has **not** been uploaded or submitted. Package validation does not
  verify the live web deployment, authentication, purchases or App Review
  acceptance; those gates above remain open. The native fix's Preview
  `4dbd97a3` is READY at `memo-f93dsa8b4-nace-valencics-projects.vercel.app`
  (`dpl_7SaVmwZgAyXxUnx535DsGZecsStb`).
- StoreKit reconciliation now checks both unfinished purchases and current
  entitlements even if an earlier delivery fails. Previously, the first
  rejected transaction prevented later purchases from reaching the server.
  Successful deliveries still finish only after server verification; failures
  stay unfinished and the first error is reported after both queues are
  checked. Cancellation propagates immediately. Five Swift regression
  scenarios pass, the full mobile suite passes (85 tests), and the rebuilt
  simulator app loads the real Apple catalogue with the three-day trial and
  renewal prices (`review-sep22-reconciliation-catalogue.xcresult`: one pass,
  15.6 seconds). Its screenshot was visually inspected. This is queue and
  catalogue coverage, not a completed Sandbox purchase or restore lifecycle.
  The same Preview settings page passes with browser and native user agents:
  Restore purchases appears only in native mode and native Stripe checkout
  returns 403 (`review-sep22-reconciliation-parity-browser.json`). The first
  browser assertion incorrectly required an exact accessible name without the
  existing icon; correcting that test locator resolved the failure. No new
  buttons or other UI were introduced.
- Optional analytics is off by default in the shared PWA and iOS Settings.
  The first-party endpoint requires consent, Vercel analytics/performance scripts
  start after opt-in, and current-consent callbacks stop later events after
  withdrawal. The visit cookie is cleared even when an older response arrives
  late. All five privacy-policy translations now explain the actual data and
  choice. TypeScript, lint, 24 focused tests, a local browser test and a deployed
  Slovenian browser test pass. The actual wrapper test on READY Preview
  `5bcc4427` passes in 51.5 seconds: default off, opt-in, relaunch, withdrawal
  and another relaunch. Native screenshots were inspected and added to the
  screenshot gallery. See `privacy-reconciliation.md` for exact evidence,
  the initial locale-assumption failure, and remaining release limitations.
- The real library workflow passes on READY Preview `28c57449`
  (`memo-bb8j0rbiz-nace-valencics-projects.vercel.app`,
  `dpl_zfrUHxm1UD1Ds1Pm92gdShEJtum9`). Phone folder menus previously had no
  way to edit their note membership; the hidden desktop menu also owned a
  separate folder list. The shared PWA now has an Add lectures action and one
  folder list shared by both responsive menus and library chat. Folder
  selection is persisted on the user's actions, so restoring it cannot erase
  it during mount. The native test checks matching/nonmatching search, note
  rename and relaunch, folder creation/rename and relaunch, adding/removing
  membership, and deleting a populated folder while retaining its note.
  `review-sep22-library-crud-final.xcresult`: one pass, 120 seconds. The three
  final screenshots were visually inspected. A separate local browser test
  against staging passed create/add/reload/remove/delete, and TypeScript,
  focused lint and 36 related tests passed. Development HMR fetch caching was
  disabled temporarily for that local run; the config change was removed.
  The final staging read (`review-sep22-library-rows-after.log`) confirms the
  circuit note is ready with its original title and no temporary folders or
  membership rows remain. Earlier harness/runner failures are not pass evidence.
- At 17:04:56 CEST, the original deletion worker completed its unchanged drain:
  Auth, the note and the deletion request were removed; all eight storage
  objects (3,635,379 bytes) were gone. It exposed one retained analytics session
  and 73 page views, with their owners set to null. The corrected engine now
  removes owned analytics before Auth deletion and clears the visit cookie.
  Five regression tests and an isolated staging integration pass, including
  anonymous-view cascade and preservation of unrelated records. The known
  original fixture's remaining analytics were removed by their captured IDs.
  At 17:10:53 CEST, the same test passed through the authenticated cron endpoint
  on READY Preview `bc816773` (`memo-12fux1759-nace-valencics-projects.vercel.app`,
  `dpl_Fx9BA4J61YhnbtxkjaQZzw2fJfEg`), with one deletion and zero failures.
  See `privacy-reconciliation.md` for evidence and limits. Session replay is
  also disabled, and the native User ID declaration now includes Analytics.
- Real tutor startup testing exposed an allowance bug: the first synthetic
  session reserved its 60-second allowance before WebKit's microphone prompt
  was answered. No explanation played; after the test terminated, the abandoned
  grant settled for all 60 seconds. Evidence:
  `review-sep22-live-tutor.xcresult`, the microphone-prompt capture, and
  `review-sep22-live-tutor-grants.json`. The second run had no remaining
  allowance and also failed; neither is a successful tutor session.
  Startup now resolves microphone permission before requesting the plan or
  speech credentials, reuses the acquired stream, and releases it on refusal
  or cancellation. A late grant returned after cancellation is settled at zero.
  All 213 tutor tests, TypeScript and focused lint pass. The used account was
  not reset.
- The real Simulator tutor rerun passes on READY Preview commit `93c30937`
  (`memo-5pomfc9re-nace-valencics-projects.vercel.app`,
  `dpl_GdKxVXwWTsUbWd72n3j9M2KHGeQr`). Using the existing Word-import account,
  the test left the microphone prompt open for 40 seconds. A simultaneous
  staging read confirmed no grant existed while the prompt was open. After
  permission, the tutor explained the circuit note, stayed paused, resumed
  explaining, and ended normally. The grant settled at **9 seconds**, with no
  charge for the permission wait. Result: `review-sep22-live-tutor-fixed.xcresult`,
  one pass, 81.5 seconds. Before/after records:
  `review-sep22-tutor-word-before-permission.json` and
  `review-sep22-tutor-word-grants.json`. Explaining, pause and end screenshots
  were visually inspected. This proves connection and session controls;
  audible quality, spoken questions and barge-in on the physical iPhone still
  need verification. The phone remained locked at the 16:10 CEST check.
- At 16:07 CEST, finished visually inspecting all 16 screenshot files fetched
  from Apple's actual uploaded asset URLs: six 6.7-inch, six 6.5-inch and four
  12.9-inch iPad images, all delivery state COMPLETE. The images show the PWA
  home, study tools and paywall without browser or Preview-feedback chrome.
  The paywall states USD 19.99/month and USD 129.99/year with a three-day trial;
  this is an English/US storefront capture, not evidence of Slovenian currency.
  Existing live-catalogue evidence separately verifies the EUR prices.
  Audit: `review-sep22-screenshot-audit.json`; inspected files and dimensions:
  `review-sep22-uploaded-assets/manifest.json`. The iPad images include the
  operating system's resize handle, also present in the build 9 capture
  `review-sep22-current-ipad.png`. Apple's documented windowing behavior:
  https://developer.apple.com/documentation/BundleResources/Information-Property-List/UIRequiresFullScreen.
  These older store images were inspected for visible problems; this does not
  prove every displayed screen exactly matches a future final Release build.
- Integrated `origin/main` at `2603764d` into `codex/ios-app-wrapper` at
  `6256fed1`; their product trees matched. The branch Preview
  `https://memo-1nyjrhksm-nace-valencics-projects.vercel.app` is READY and uses
  the shared staging Supabase project. The user confirmed that fresh iOS
  installs must match the PWA: onboarding first, then sign-in.
- Native simulator build passed; 126 focused mobile tests and all 1,552 web
  tests passed. These checks do not prove real Apple authentication or billing.
- App Store Connect API confirms version 1.0 is READY_FOR_REVIEW in an
  **unsubmitted draft**, with VALID build **1.0.0 (9)** attached and manual
  release selected. Draft `b7aa39c6-3b7a-4e6c-a0c5-75dc3c54d2be` contains the
  app version, all four subscription versions and their subscription group.
  Its `submittedDate` is null. All 16 uploaded screenshots are COMPLETE;
  review credentials, contact and metadata are present. Content Rights is
  populated (`DOES_NOT_USE_THIRD_PARTY_CONTENT`), but needs the account holder's
  rights confirmation before correcting it for document/web-page imports.
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
- Latest user requirement: the wrapper is portrait-only on iPhone and iPad.
  Both plist orientation arrays, the app delegate and the root controller now
  restrict orientation to portrait. iPad requests compatibility mode, which
  prevents classic Split View on older iPadOS; current iPadOS can still scale
  its presentation in a system-managed window (see the limit above).
  Build 9 Simulator tests pass on both devices, including launch while sideways,
  both landscape directions and upside-down rotation; the PWA viewport stays
  vertical. Build 9 uploaded successfully, is VALID and is attached to the
  unsubmitted draft (build `71d15309-be70-46f9-8dfd-f3ea5c8d8cbb`, relationship
  verified through Apple's API). It is installed on the iPhone; the device was
  locked when launch was attempted, so the new build has not been exercised
  on physical hardware. The draft still has six READY_FOR_REVIEW items,
  `submittedDate: null`, and manual release selected.
  Earlier landscape screenshots are historical and no longer describe the app.
- Actual account deletion passed for the synthetic study account. The UI showed
  the irreversible-deletion/Apple-subscription disclosure, returned the deletion
  confirmation and ended access. Staging records the access-block marker and
  cleanup request. The three-hour drain ends at 17:04:40 Europe/Ljubljana;
  final erasure remains pending. A task-owned checker waits for that deadline
  before calling the authenticated Preview cleanup route. Preview-only cleanup
  authorization was added to this branch; no production configuration changed.
- Build 9's actual public-article flow passes on the current staging Preview:
  New note → Web link → the USGS water-cycle article → generated notes. The
  UI test verified actual evaporation content, and the retained screenshot
  shows the completed Water Cycle note. Result:
  `review-sep22-public-article-final.xcresult` (74.2 seconds, one test, no failures).
  The initial combined runner ran creation before account setup alphabetically;
  that harness ordering was corrected before the passing run. No account quota
  or generated-content rows were modified to obtain this pass.
- Rechecked the public production terms, privacy and refund URLs: all return
  HTTP 200 after the canonical host redirect. Terms and privacy contain the
  correct **Zgoša** address. The consent disclosure names Google Gemini,
  Soniox, OpenRouter and its model providers, and links to the privacy policy;
  the published source policy describes those services and account deletion.
  This is a content/accessibility check, not proof of legal compliance or Apple
  approval. Apple's current guidelines still require actual working review
  access, purchase behavior, explicit AI-sharing permission and in-app deletion:
  https://developer.apple.com/app-store/review/guidelines/.
- Actual AI-consent withdrawal passes on build 9: Settings → Withdraw AI
  permission → confirm → consent screen; terminating and relaunching retains
  the gate. Explicitly allowing processing again restores access to the
  library. Result: `review-sep22-consent-withdrawal-verified.xcresult`, 36.5
  seconds, one test, no failures. Initial harness attempts missed the opening
  offer and the emoji-prefixed row label; selectors/navigation were corrected,
  without changing the product's consent behavior.
- Fetched and integrated the subsequently released PWA startup fix at
  `origin/main` `a6be0d41` into this task branch (`0c46a612`). It keeps the
  initial shell consistent with server rendering and recovers stale route
  content. Its 11 focused hydration tests and TypeScript checking pass.
  Preview `memo-jkf65k6fg-nace-valencics-projects.vercel.app` is READY at
  `22251866`. The real-browser regression passes with web and iOS user agents:
  stale routes recover without React errors, and normal navigation/back/forward
  retain the shell. The actual iOS settings, theme and scroll test also passes
  (`review-sep22-hydration-native.xcresult`, 23.5 seconds). No production merge
  was performed by this task, and build 9's native binary is unchanged by this
  web-only integration.
- Actual PDF import also passes on build 9: the native Files picker selected
  `memo-qa-electric-circuits.pdf`, the PWA uploaded it, and the note workspace
  displayed generated resistance/circuit content. The original, visually
  checked synthetic fixture is committed under `ios/MemoAIUITests/Fixtures`.
  Result: `review-sep22-pdf-import-picker.xcresult`, one test, zero failures,
  68 seconds. The first runner's account preparation and language reset passed;
  import initially stopped on an exact `Choose File` selector, corrected to
  match the system's plural file-picker label. The pass used a new synthetic
  account's normal unused free note on Preview
  `memo-1n6o49ce2-nace-valencics-projects.vercel.app` (25c1649b), not the
  subsequent hydration integration. The branch-only review-email allowlist
  includes that account; global staging database configuration is unchanged.
- Found that the legacy project generator could overwrite maintained manifests
  and translations with stale defaults. It now preserves/copies the checked-in
  app and extension manifests, entitlements, privacy manifest and localized
  strings instead of maintaining duplicate versions. Isolated generation
  reproduced all 14 files byte-for-byte; checks confirmed portrait-only/full
  screen, app-bound hosts, APNs and FileTimestamp/DeviceID privacy declarations.
  The generated project passes plist validation. The shipped files and build 9
  were not regenerated or changed by this maintenance fix.
- Fixed the circuit-note formatting bug at `c1cd4bbf`: the note processor
  omitted capital and variant Greek commands from its math detection, stripping
  valid delimiters around `\Omega`. The 97 affected math/mobile checks and
  TypeScript validation pass. Preview `memo-lvfffyrvm-nace-valencics-projects.vercel.app`
  is READY. A fresh synthetic account imported the original PDF through the
  native picker; all three setup/language/import tests pass in
  `review-sep22-math-import.xcresult`. Staging stores `**ohms (\(\Omega\))**`,
  and the actual app screenshot displays Ω correctly. This did not rewrite the
  earlier synthetic note or reset any account's allowance.
- Portrait-only behavior now also passes on the physical iPhone 16 with build
  9 (`review-sep22-device-portrait.xcresult`): sideways launch, both landscape
  directions and upside-down rotation retain a vertical app and PWA viewport.
  The retained screenshot shows the actual sign-in screen with Google, Apple
  and email. The first launch waited for the phone to become unlocked.
- Apple's signed Sandbox TEST notification reached the branch Preview and
  Apple reported `SUCCESS`; local certificate verification confirmed type TEST
  and Sandbox environment. Two replays returned HTTP 200 with `received: true`.
  The Sandbox callback URL was temporarily pointed at this Preview and restored
  to its original `https://www.memoai.eu/api/mobile/notifications` value after
  verification; the production callback URL was preserved. Evidence:
  `review-sep22-sandbox-notification.json`. This verifies delivery/signature
  handling, not purchase-ledger writes, renewal or refund behavior.
- The actual iPhone Apple button opens Apple's native Sign in with Apple sheet
  for Memo AI. `review-sep22-device-apple-signin.xcresult` records this as a
  deliberately skipped authentication inspection, not a completed sign-in.
  Provider authentication still requires a designated test Apple account.
- Rechecked the uploaded screenshot records after the portrait-only change:
  all 16 are COMPLETE and portrait (1320×2868, 1284×2778, 2064×2752).
  Evidence: `review-sep22-screenshot-audit.json`. This is an asset/state and
  orientation check, not a new visual comparison of every uploaded image.
- Actual audio-file import exposed an indefinite metadata wait in WKWebView:
  choosing the original 92-second M4A left creation disabled with no feedback.
  Commit `03a05823` explicitly loads metadata, bounds each probe, releases its
  media resources and shows translated preparation progress. The existing
  transcode fallback then prepares an MP3 when WebKit does not answer. On READY
  Preview `memo-ouat4dqak-nace-valencics-projects.vercel.app`, the same synthetic
  account and M4A pass native import, transcription, generated notes and reading
  the transcript (`review-sep22-audio-import-retry.xcresult`, 133.5 seconds).
  Staging confirms an audio lecture with duration 92 and status ready. No quota
  was reset after the initial failure. The desktop browser also reads the
  original AAC duration successfully; its duration includes codec padding.
  All 117 affected audio/math/mobile/i18n tests, type checking and focused lint
  pass. The fixture and its original synthetic script are retained in the repo.
- The source recording also passes actual playback, pause, ten-second seeking
  in both directions and playback-speed selection on the same audio note.
  `review-sep22-source-audio-playback.xcresult` passed in 52.9 seconds; the
  screenshot shows paused playback at 0:04 and 1.5×. This confirms playback
  controls and advancing media time, not perceived speaker audio quality.
- Actual Word import passes on READY Preview
  `memo-j5l9znk52-nace-valencics-projects.vercel.app` at `03a05823`:
  native Files selection of the original DOCX, upload and generated circuit
  notes. `review-sep22-word-import.xcresult` has three passes (account setup,
  language, import); the import took 82.3 seconds. Staging confirms the note
  is ready. The selected file and rendered result were visually inspected.
  The fresh account consumed its ordinary free note; no allowance was reset.
- Actual PowerPoint import passes on that same Preview: native Files selected
  the original PPTX, Memo recognized three slides and generated a completed
  circuit note. `review-sep22-slides-import.xcresult` has three passes; the
  import took 74.1 seconds. The selected PPTX and final note were visually
  inspected. `review-sep22-office-status.json` confirms both Office notes are
  ready. These fixtures cover editable text, not embedded Office media.
- The 22 September 15:50 CEST email search still found the Small Business
  enrollment receipt and no approval message. The reduced commission remains
  unconfirmed.
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

## Historical release gates recorded on 17 September

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

## Historical operational blockers recorded on 17 September

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

### 23 September: native keyboard motion and analytics Settings

- The controller is mounted once in the root layout and follows focus globally,
  including chat inputs, textareas, search, editors and portalled sheets. The
  final audit reran all 97 mobile/keyboard regressions successfully. Actual
  device coverage below is specific; it is not a measured frame-rate guarantee
  for every field or device.

- Bridge v4 now supplies UIKit keyboard-layout presentation frames to the shared
  PWA keyboard controller. Library/note chat, search and rename passed on the
  actual Preview in Simulator (`review-sep23-keyboard-product.xcresult`) and on
  the connected iPhone 16 (`review-sep23-iphone-keyboard-product.xcresult`). All
  composers and sheets retain the shared design and keyboard CSS variables.
- A local fixture loading the real controller/styles passed three form and
  three chat cycles (`review-sep23-keyboard-motion-idle.xcresult`). Measured
  median/p95 moving-frame intervals were 17 ms; settled footer/composer gaps
  were 12 pt. Both ended at zero inset. This verifies the simulator cadence,
  not a claim of measured 120 fps on hardware. ProMotion support is enabled.
- The sampler sleeps at rest and while backgrounded. An extra delayed study
  editor scroll is disabled for bridge v4. Browser/older-wrapper fallback stays.
- Analytics is now a compact Settings row opening the full disclosure sheet.
  Both user agents, light/dark and desktop layout passed on the Preview. It
  remains opt-in. A physical relaunch exposed an older cookie overriding a
  newer withdrawal; the saved withdrawal now vetoes that stale grant, without
  ever using saved grants to restore missing or expired cookie consent.
- These changes need the new native binary and matching web deployment. The
  earlier validated release archive does not include them. Existing submission
  gates above remain open; no App Review submission has been made.
- Final analytics device check passed after the withdrawal fix:
  `review-sep23-iphone-analytics-durable.xcresult`. Opt-in survived relaunch,
  withdrawal survived a second relaunch, and the synthetic QA device was left
  opted out. Both browser/native user-agent checks also passed on the READY
  `f50fd7e0` Preview. TypeScript, ESLint and 109 focused regression tests passed.
