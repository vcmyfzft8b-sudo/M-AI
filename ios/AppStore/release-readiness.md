# iOS release readiness — 16 September 2026

**Not ready for App Review or production activation.** This is the release gate,
not a claim that compiling or passing the wrapper tests verifies the whole app.

## Verified implementation and evidence

| Requirement | Evidence and scope |
| --- | --- |
| Use the actual PWA screens | Shared `OnboardingPaywall`, `DiscountOffer` and `SettingsScreen`; no separate native replacement paywall. Actual staging walkthrough covered email login, consent, 23 onboarding steps, home, paywall, wheel and settings. Generated-content flows remain below. |
| Keep current PWA fixes | Merged freshly fetched `origin/main` through `222b7382`, including the tutor sample-rate fix. Three audio regression tests pass in `ios/build/upstream-audio-tests.log`. TypeScript and web build pass in `release-parity-types.log` and `release-parity-web.log`. |
| No browser controls over Memo | Root WKWebView has no address bar/tabs; embedded Safari sheets and link previews removed. Branch-only Vercel preview toolbar disabled. `browser-free-final.xcresult` passes against Preview `6afed733`; actual home and light/dark settings screenshots have no preview toolbar. |
| Scrollable PWA settings | Actual Preview XCTest selects Light/Dark/System and scrolls to Language, Restore and Manage Apple subscriptions. This does not prove a completed restore transaction. |
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
5. **Actual study flows:** create a synthetic note through recording, document,
   text and supported link input; verify generated notes, quizzes, flashcards,
   mindmap/palace, chat, read-aloud, podcast/tutor, export/share and deletion.
   Onboarding demonstrations and wrapper fixtures do not prove these flows.
   Test real microphone/camera, interruptions and audio on the iPhone, and the
   actual app layout on iPad. Decide/configure Apple purchase support for any
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

## Current operational blocker

The Mac is locked; the computer-use tool's automatic unlock fails. Xcode UI tests
can run and capture the simulator independently, but direct Apple portal and
authentication interaction cannot continue. The previous distribution export
also returned “No Accounts” / “No signing certificate” while locked. Unlocking
the Mac with its owner's credentials is required; power and Caffeinate do not
unlock an existing session. Do not reset credentials or disable the lock.

## Sources for Apple-specific behavior

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [App privacy details, including embedded web views](https://developer.apple.com/app-store/app-privacy-details/)
- [Offer-code integration](https://developer.apple.com/documentation/storekit/supporting-offer-codes-in-your-app)
- [App account token association](https://developer.apple.com/documentation/appstoreserverapi/set-app-account-token)
- [Vercel preview-toolbar configuration](https://vercel.com/docs/vercel-toolbar/managing-toolbar)

These references guide implementation; they do not establish Apple's approval
of Memo or replace the unresolved end-to-end checks above.
