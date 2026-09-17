# Memo AI iOS — handoff for the next agent (written 17 September 2026)

Read this before `docs/ios-app.md` (setup reference) and `ios/AppStore/release-readiness.md` (evidence log).

## Where things stand

- Branch `codex/ios-app-wrapper` is merged into `main` (PR #415, #418). Production runs the wrapper-aware web app; the iOS project is in `ios/`.
- Production is configured: Vercel flags `APPLE_SIGN_IN_ENABLED`, `NATIVE_GOOGLE_SIGN_IN_ENABLED`, `APPLE_IAP_ENABLED`, `APPLE_WEB_SIGN_IN_ENABLED` are on, with the keys and ids they need. Production Supabase has the Apple provider (`eu.memoai.memo,eu.memoai.web`). App Store Connect has the app record, four subscriptions, notification URLs (www host) and two API keys.
- Build **1.0.0 (1)** is uploaded, processed and in internal TestFlight testing (group "Memo internal"; the account holder is invited). Nothing has been submitted for App Review.
- Web "Continue with Apple" is live and reaches Apple's sheet; a full round trip with a real Apple Account has not been recorded yet.

## The separation contract (do not break it)

The web app must behave exactly as before for browsers; the app must never show Stripe.

- **Detection:** the wrapper sets the user agent suffix `MemoAI-iOS/1.0`. Server code uses `isNativeUserAgent()` (`src/lib/mobile/runtime.ts`); client code uses `useNativeIOS()` / `isNativeIOS()` (`src/lib/mobile/client.ts`); CSS uses `html[data-native]`, set by the root layout only for that user agent. Presentation only: never authorize by user agent.
- **Billing:** `/api/billing/checkout`, `/api/billing/portal`, `/api/billing/tutor-credits` return `403 native_purchase_required` to the app; the app's paywalls call StoreKit through `useAppleBilling` and the server verifies transactions in `/api/mobile/transactions`. Browsers never see `useAppleBilling`, "Restore purchases", "Manage Apple subscriptions" or the Apple terms line. An Apple subscriber who logs in on the web has paid access (`hasPaidAccess` includes the Apple entitlement) and sees an Apple management link instead of the Stripe portal — that is intended.
- **Sign-in:** Google inside the app goes through `ASWebAuthenticationSession` and `/api/mobile/google-auth`; Apple inside the app uses the native ID token via `/api/mobile/apple-auth`; the web uses Supabase OAuth for both. The web Apple button is gated by `APPLE_WEB_SIGN_IN_ENABLED`.
- **Guards:** `tests/mobile-billing-guards.test.mjs`, `tests/mobile-paywall-parity.test.mjs`, `tests/mobile-auth-options.test.mjs` and the rest of `tests/mobile-*.test.mjs` fail if a Stripe path opens for the app or an Apple path leaks to the web. Keep them green. New web features that touch billing, login, the install guide or the home dock must be checked with both user agents (`curl -A "... MemoAI-iOS/1.0"` against a preview is enough).
- **Safe-by-default flags:** every native path is also behind an env flag that defaults off, so a preview without the flags behaves like the plain web app.

## Remaining work, in order

1. **Device checks on the TestFlight build** (account holder's iPhone, cannot be done in the simulator): Google and Apple sign-in complete and resume after relaunch; recording and the tutor (microphone, interruptions, locked screen); a Sandbox purchase with the Slovenian Sandbox tester (trial monthly/yearly and the wheel's discounted products), then restore on the same account, a wrong-account restore, cancellation and expiry in the Sandbox; Settings → Manage Apple subscriptions; account deletion of a synthetic account (Apple grant revoked, storage erased by the hourly cron). Fix whatever fails, bump `CURRENT_PROJECT_VERSION` in `ios/Config/App.xcconfig`, re-archive, re-upload (commands below).
2. **Web Apple sign-in round trip:** complete Apple's sheet once on production with a real Apple Account, confirm `/auth/callback` lands on `/app`, that a second sign-in resumes the same account, and try "Hide My Email". Rotate the Supabase client secret before **16 March 2027** (`node scripts/apple/web-client-secret.mjs eu.memoai.web`).
3. **App Store Connect listing** (Browser pane, account holder signed in): iPhone 6.9" and 6.5" plus iPad 13" screenshots from the TestFlight build with synthetic content (home, note, flashcards, quiz, tutor, paywall); the age-rating questionnaire (AI chat → answer the "unrestricted web access / user-generated content" questions truthfully; the app has no web browser); the privacy questionnaire from `ios/MemoAI/PrivacyInfo.xcprivacy` (do **not** pick "Data Not Collected"); review notes from `ios/AppStore/metadata.md`.
4. **Review account:** create a real production account for App Review with a password via `/auth/password` (email + strong password), complete onboarding, put its user id in `APPLE_SANDBOX_REVIEW_USER_IDS` on Vercel Production so its Sandbox purchases are accepted, and give the credentials only inside App Store Connect's review sign-in fields.
5. **Subscriptions:** move all four products to the same service level in the "Memo Premium" group (Apple's drag-reorder failed for automation; do it by hand), add a subscription review screenshot per product, and attach the four subscriptions to the version before submitting. After the first approved build, retry turning **Streamlined Purchasing** off (Apple refused until a build with `PurchaseIntent` exists).
6. **Submit:** select build 1.0.0 (n), fill export compliance (already answered "no" by `ITSAppUsesNonExemptEncryption`), and submit for review with manual release. Watch Sentry and `vercel logs` for `/api/mobile/*` errors after release.
7. **Business status to confirm, not assume:** Small Business Program (submitted, no decision e-mail yet), EU trader declaration (In Review). Do not claim the 15 % commission until Apple confirms.

## Commands and tooling

- Archive: `xcodebuild -project ios/MemoAI.xcodeproj -scheme MemoAI -configuration Release -destination generic/platform=iOS -derivedDataPath ios/build-archive -archivePath ios/build/MemoAI-release.xcarchive -allowProvisioningUpdates archive`
- Export (cloud signing needs the **Admin** key; an App Manager key fails with "Cloud signing permission error"): `xcodebuild -exportArchive -archivePath ios/build/MemoAI-release.xcarchive -exportOptionsPlist ios/Config/ExportOptions.plist -exportPath ios/build/export-release -allowProvisioningUpdates -authenticationKeyPath ~/.config/memoai/apple/AuthKey_M2VD53GP68.p8 -authenticationKeyID M2VD53GP68 -authenticationKeyIssuerID 6715f045-a181-4ad1-b072-5824a5bf1220`
- Validate / upload: `xcrun altool --validate-app|--upload-app -f ios/build/export-release/MemoAI.ipa -t ios --apiKey M2VD53GP68 --apiIssuer 6715f045-a181-4ad1-b072-5824a5bf1220` (altool reads the key from `~/.appstoreconnect/private_keys/`, symlinked).
- Builds and any App Store Connect API call: `node scripts/apple/asc-builds.mjs`, `node scripts/apple/asc-api.mjs GET /v1/...`.
- Simulator QA against the staging preview: the ignored "MemoAI Preview QA" scheme, the signed-in simulator and the synthetic account are described in `docs/ios-app.md` and the memory note; run `xcodebuild … -scheme "MemoAI Preview QA" … -only-testing:MemoAIUITests/WrapperTests/<test> test` with the QA simulator UDID.
- Private material lives only in `~/.config/memoai/apple/` (IAP key, Sign in with Apple key, both API keys, `server.env`). Never commit it or paste it into chat.

## Gotchas already paid for

- The apex host `memoai.eu` answers a POST with a 307 to `www`; Apple's notification client will not follow it, so every server URL uses `https://www.memoai.eu/…`.
- Attaching `Offers.storekit` to the preview scheme stops the app loading under UI tests; the simulator therefore shows the US storefront. Real prices (€19.99 / €129.99) come from App Store Connect and appear on a Slovenian Apple Account.
- A tap in the UI tests before React hydrates is lost; the preview tests retry.
- The synthetic account's free note is one-shot; the study-flow test reopens the note it created.
