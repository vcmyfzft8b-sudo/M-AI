# Memo iOS submission checklist

## App Review pass on 26 September 2026 (#495, #496, build 21)

- **Restore (#495, build 20):** Restore reconciles even when `AppStore.sync()`
  fails or is cancelled; a cancel is quiet. Verified on the physical iPhone
  against production: a subscription owned by another Memo account says so.
- **3.1.2 billed amount (#496):** the app's paywall and wheel offer led with a
  per-month / per-week figure. They now lead with what Apple bills for the
  period. Web unchanged. Guarded by `mobile-paywall-parity`.
- **2.1 reachable IAP (#496):** the tutor hour was only offered after a
  subscriber's 30 daily minutes ran out. Subscribers can now top up from the
  tutor-time meter at any time (web and app); the review notes say where.
- **4.2 website feel (#496, native, build 21):** WebKit's "Allow “host” to use
  your microphone?" appeared before iOS's own prompt on every launch. Memo's own
  pages are now granted in WebKit; iOS's permission still decides.
- **Bugs:** a refused tutor start did nothing visible (now opens the
  tutor-time sheet); the first onboarding step's dead back arrow is hidden.
- **Checked, no change needed:** no tracking SDKs (analytics opt-in, first
  party; no ATT needed); App Privacy labels match; production serves the app
  both Apple and Google sign-in and no Stripe purchase path; Sign in with Apple
  grants are stored in production (exchange works with the revoke key);
  refund/revocation removes access (unit tests); iPad: onboarding, paywall,
  settings rows, delete sheet, note in portrait and sideways.
- **Still only the owner can do:** install 1.0.0 (21) from TestFlight, sign in
  with the review account, listen to the tutor, and say "submit". A real
  Sign in with Apple revocation needs a spare Apple ID.
- **Residual judgement risks:** the daily discount wheel always lands on the
  same Apple introductory offer; the iPad layout is the phone layout, wider.

## Status on 23 September 2026 (after #476, #477, #478)

- **Production:** #476 (billing lifecycle, creator codes via Apple, keyboard
  spring, web analytics), #477 (App Store tutor hour) and #478 (notification
  launch opens its note) are merged and deployed; migration `0055` applied and
  verified in the live schema; local `main` = `origin/main` (`ea6fd066`).
- **App Store Connect:** version 1.0 has **build 16** attached, final review
  notes (codes, notifications, account binding, tutor time) and five products
  READY_TO_SUBMIT: four subscriptions and the consumable `eu.memoai.tutor.hour`
  (€2.00, review screenshot uploaded). The tutor hour must be added to the
  review submission together with the version. **Not submitted.**
- **Verified on the physical iPhone (Sandbox):** trial purchase, renewal,
  restore, cancellation, expiry, `MEMO50` promotional purchase with creator
  credit, account binding, push delivery, recording, tutor-hour purchase
  (credited once, 3600 s). Simulator: languages, settings rows, study tools,
  keyboard spring frame by frame, notification launch opening its note.
- **Left for the owner:** install 1.0.0 (16) from TestFlight with the review
  account and check keyboard feel, a notification tap, recording playback and
  the tutor's voice; delete the accidental staging recording on `ios-text`;
  then authorize submission.

## What is already done

- The iOS wrapper shares the PWA, including onboarding first, study tools and
  settings. Native billing and authentication are deliberate platform differences.
- Apple and Google sign-in completed on the physical iPhone. Email-code flows,
  core study features, portrait layout, keyboard handling and settings have test
  evidence. This does not replace a final release smoke test.
- A real Sandbox yearly-trial purchase, server entitlement, restore and access
  after relaunch passed on a synthetic account.
- Slovenia regular prices are €19.99/month and €129.99/year. Eligible discounted
  first periods are €9.99/month and €64.99/year, followed by the regular price.
  Separate trial products have a three-day free trial. Prices come from StoreKit;
  a US storefront correctly displays dollars even with Slovenian interface text.
- Build **1.0.0 (12)** with keyboard bridge v5 and the public keyboard accessory
  implementation is **VALID / IN_BETA_TESTING** in the Memo internal group.
  Use the `release-12-public` artifacts, not the superseded build-12 archive.
- Paid/Free Apps Agreements, bank, tax, EU trader and DAC7 statuses were verified
  Active. The Content Rights declaration is recorded after owner confirmation.
- App Privacy was reconciled and published; age-rating answers were corrected
  with a 16+ override. Optional analytics is implemented as opt-in, off by default.
- Synthetic account deletion erased owned Auth, Storage, note and analytics data
  after the existing three-hour drain; unrelated account data stayed intact.
- The restricted Stripe catalogue credential works and is configured on this
  Preview branch. The new Slovenia Sandbox tester exists, configured for
  five-minute monthly renewals. Neither setup step needs repeating.
- The redesigned code screen passes hosted light/dark, validation, cancellation
  and browser/native separation checks. The actual iOS simulator test also passes
  with real StoreKit prices and keyboard clearance (163.685 seconds). It does
  not purchase the promotional offer.

## 1. Finish real Apple billing tests

Use synthetic accounts and the dedicated Sandbox tester. Record the product,
storefront, transaction result and independently verified server entitlement.
Do not fabricate entitlement or use real paid checkout for these tests.

- [x] Sign the new Sandbox tester into the test device and confirm its storefront.
  *23 Sep: signed in by the owner on the iPhone 16; purchases are Slovenia/EUR.*
- [ ] Cover monthly and yearly purchases, including the separate three-day trial
  products. Check eligible/ineligible trial users, displayed renewal terms and
  trial-to-paid entitlement updates.
- [ ] Complete actual code purchases and restore: a new subscriber's introductory
  offer and a returning Apple subscriber's server-signed promotional offer.
  Price display and validation have passed; those promotional purchases have not.
- [ ] Verify €9.99/€64.99 first periods and €19.99/€129.99 renewals in Slovenia.
  Verify the wheel shows the applicable offer and cannot promise an unavailable
  discount or combine a free trial and discount incorrectly. Check its daily limit.
- [ ] Exercise accelerated renewal, auto-renew cancellation, access until expiry,
  expiry, refund and revocation. Confirm server notifications update access.
  *23 Sep, physical iPhone, fresh account `ios-text`: yearly trial purchased
  (Apple offerType 1, ledger = Apple), renewed to the first paid year
  (RENEWAL, reached the ledger when the app reopened), Restore + relaunch kept
  access, cancelled through the app's Manage Apple subscriptions
  (autoRenewStatus 0, still active until 10:41 UTC). Expiry, refund and
  revocation remain. Staging notifications go to production's URL, so on
  staging the app, not a notification, delivers renewals.*
- [ ] Exercise cancelled, interrupted/offline and pending purchases; retry or
  restore after delivery failure and ensure duplicate events remain harmless.
- [ ] Verify purchases stay bound to the correct Memo account, restore works on
  that account, and an existing paid user cannot accidentally buy twice.
  *Binding verified on the iPhone: Restore on `ios-audio` granted nothing and
  now says the purchase belongs to another Memo account (`bb2cad0a`); it used
  to say "try Restore again" forever. A second account's paywall correctly
  offered the paid plan, not the used trial. Buy-twice still to check.*
- [ ] Repeat purchase/restore and Manage Apple subscriptions in the final
  TestFlight build against the final production configuration.

## 2. Resolve the remaining discount-code parity gaps

- [ ] Verify creator-code attribution with a real Sandbox code purchase.
  *Implemented 23 September (`92c98bfb`, migration `0055`, tried on staging
  only):* the server records a validated code and credits the Apple purchase
  that follows within a day; `/admin` creator figures count that first charge
  like Stripe's. The credited amount is Apple's customer price (before Apple's
  commission and VAT); the owner decides the payout base. Unit and migration
  tests pass; the end-to-end purchase check needs the iPhone.
- [x] Resolve scope for the audited legacy recurring/gift codes. *Owner decided
  on 23 September to exclude them from v1; they keep failing closed.* Audit: the current
  native flow supports 24 unrestricted 50%-off-once codes, not the seven legacy
  10%-off-forever codes or the 100%-off-forever gift code. These fail closed.
  Provide compatible Apple offers or explicitly agree to exclude them from v1;
  do not claim every Stripe code has identical native behavior.
- [ ] Recheck invalid, disabled, expired, restricted and capped codes and ensure
  displayed terms match the actual Apple purchase sheet.

## 3. Finish authentication, deletion and privacy verification

- [ ] Test actual Sign in with Apple authorization revocation during account
  deletion using a designated disposable test identity, not the owner's account.
- [ ] Repeat deletion and independent data-erasure verification on the final
  deployed release, including sign-out and subscription-cancellation guidance.
- [ ] Repeat Apple, Google and email sign-in, cancellation, sign-out and session
  restoration from a clean final TestFlight install.
- [ ] Verify analytics stays off until consent, turning it off stops collection,
  and the final deployed app does not initialize session replay.
- [ ] Reconcile final App Privacy labels and privacy manifest with actual shipped
  AI, support, billing, diagnostics, location and notification data flows.
- [ ] Check AI consent and withdrawal, privacy/terms/refund/support links and
  account deletion are reachable, translated and styled consistently.

## 4. Finish physical-device and product checks

- [ ] Actually listen to microphone recordings and playback; verify audio quality
  and upload completion. UI success alone does not establish audible quality.
- [ ] Check recording while locked/backgrounded and recovery from an actual call
  or audio interruption, including the Live Activity and saved recording.
- [ ] Complete spoken-tutor and audio/podcast listening checks; confirm haptics
  feel appropriate on the physical iPhone.
- [ ] Test denied/revoked microphone, camera and photo permissions and recovery;
  offline/reconnect handling, external authentication return and sharing.
- [ ] Run the final reviewer walkthrough: clean install → onboarding → each login
  option → consent → create/import a note → study tools and both chats → settings
  → trial/paywall/wheel/code → restore/manage subscription → deletion.
- [ ] Recheck applicable photo/PDF/Word/slides/text/link, flashcard, quiz, practice,
  mindmap/export, memory-palace and reader flows on the final release.
- [ ] Keyboard motion (owner, 23 Sep: must move out of the way as smoothly as
  native iOS). *Found: the chat bar slid under the keyboard for the first
  frames (recording, frame by frame). Fixed in `cd6b2236`: the wrapper hands
  over UIKit's keyboard spring (mass 1, stiffness 555.03, damping 47.12,
  0.383 s) and the page draws each frame where the keys will be. Verified on
  the simulator for the note chat, library chat and rename sheet, opening and
  closing. Needs build 14 on the iPhone and the owner's own feel check.*
- [ ] Check all keyboard entry points and sheets, portrait rotation lock, loading
  screen, safe areas, light/dark themes, larger text and supported iPad layouts.
- [x] Verify regional first-run language for English, Slovenian, Croatian, Bosnian
  and Serbian, matching the PWA's current behavior. *Manual selection is done:*
  `testPreviewAllSettingsLanguagesPersist` passed on 23 September (279.9 s,
  simulator, Preview for `421e2d26`, result `review-sep23-languages-sim-r5`).
  Each language survives a relaunch and translates the Apple code form. It found
  and fixed a bug: the code form's back arrow went to Help instead of Settings.
  Regional first-run: a fresh request with the iOS user agent from Slovenia
  served `lang="sl-SI"` onboarding; HR/BA/RS/other mappings are the shared
  `localeForCountry` covered by `tests/i18n-catalogues.test.mjs`.
- [ ] Confirm no browser toolbar, install prompt, landing page or development
  overlay appears in the main app. Authentication/external-link system UI and
  iPadOS window controls are not app browser chrome and cannot all be suppressed.
- [ ] Confirm any paid voice-credit capability has an Apple-compatible purchase
  path or a clearly agreed launch scope; an iOS-hidden paid web feature cannot
  silently count as full PWA parity.

## 5. Notifications: finish if included in v1

Note-completion notifications are implemented but the last inspected Preview
configuration lacked `APPLE_PUSH_*`, so live delivery remains unverified.

- [x] Decide whether notifications ship in v1. *Owner: ship.* APNs key
  `2HU95KN368` verified against both APNs hosts (a fake token returns
  BadDeviceToken, not InvalidProviderToken); the four `APPLE_PUSH_*` values are
  set on this branch's Preview. Build 12 carries `aps-environment=production`.
  Production values and live delivery remain below.
- [ ] Verify notifications end to end.
  *23 Sep, physical iPhone, staging: device token registered (sandbox), a
  finished note queued its push, and three separate notes delivered "Your
  notes are ready — <title> is ready to study" to the iPhone (screenshots in
  `review-sep23-device-push-*`). Previews do not run Vercel crons, so the
  per-minute sender was triggered by hand there; production runs it. Still
  open: a human tap on the notification opening the note (UI-test taps on
  Notification Center only dismissed it), and production APNs delivery.* If yes, securely configure APNs
  for the intended environments and verify permission allow/deny, token
  registration, background/terminated delivery, correct-note navigation on tap,
  and sign-out/deletion cleanup. If deferred, keep the feature disabled and remove
  any launch promise that it works. This is a product-scope decision, not an
  automatic App Review blocker.

## 6. Finish production and TestFlight release validation

- [ ] Review the final branch diff and passing Preview checks, then obtain the
  owner's production merge/release authorization. Existing authorization covers
  pushing the test branch; it does not authorize a production merge or submission.
- [ ] Deploy approved web changes to production. Configure the restricted code
  catalogue credential there securely; its successful branch Preview setup is
  not production setup. Verify other Apple auth, billing, encrypted token and
  notification configuration and callback URLs without exposing credentials.
- [ ] Apply any required committed migrations only through the main-branch
  migration workflow after merge. Preview tests must stay on shared staging.
- [ ] Verify the production deployment commit separately from local/GitHub sync.
  Confirm the final archive uses production endpoints with no debug fixtures,
  auth bypasses or preview origins. Preserve a controlled reviewer login.
- [ ] Use build 12 if it remains the correct native binary; archive/validate/upload
  a new build if native changes require it. Install through TestFlight and verify
  that exact build with the final production web deployment.

## 7. Final App Store Connect submission check

- [ ] Replace the draft's old **build 9** with the final tested build. Version 1.0
  has manual release and the four subscriptions/group in its unsubmitted draft.
- [ ] Verify subscription metadata, review screenshots, localization, prices,
  offers, availability and required agreements still have no blocking omissions.
- [ ] Refresh marketing screenshots wherever the shipped UI differs, using the
  supported iPhone/iPad sizes and actual app UI. Send the owner the final evidence
  screenshots separately; automated screenshots with simulated prices are not
  evidence of a completed Apple purchase.
- [ ] Recheck description, support/privacy URLs, age rating, Content Rights,
  export compliance and App Privacy against the exact release.
- [ ] Verify the review account and code from a clean install, without the owner's
  personal credentials. Review notes must explain access, AI consent, native
  recording, trial/discount eligibility and subscription testing accurately.
- [ ] Verify the business/trader contact details, including **Zgoša 87** and the
  owner's requested s.p. information. Confirm what Apple actually shows for the
  seller under this individual membership; do not promise a company seller name
  merely because the bank/trader details use the s.p.
- [ ] Ask for final submission authorization only after the blocking checks pass.
  No App Review submission has been made.

## Business follow-up that is separate from approval readiness

- [ ] Confirm acceptance into Apple's Small Business Program. The application
  receipt is confirmed; approval of the 15% commission is not. This is not by
  itself a reason to describe the app as broken or unable to submit.

## Continuation references

- Assigned worktree: `/Users/nacevalencic/.codex/worktrees/b2ab/Memo_AI`.
- Branch: `codex/ios-app-wrapper`; latest UI commit: `5b283dac`.
- Latest READY UI Preview:
  <https://memo-ebx5i4rr2-nace-valencics-projects.vercel.app>.
- Build: 12, public keyboard implementation; App Store Connect app `6812409212`.
- Detailed dated evidence: [release-readiness.md](release-readiness.md).
- Privacy audit: [privacy-reconciliation.md](privacy-reconciliation.md).
- Release metadata: [metadata.md](metadata.md).
- Local evidence is under `ios/build/` and is ignored by Git. Keep it on this Mac;
  do not publish private test logs, environment files or credentials.

The owner may still need to perform Face ID/physical button confirmation or an
account verification challenge. Everything else should continue through CLI,
APIs and isolated tests where possible so the owner can keep using the Mac.
