# Memo AI for iOS

## Status

**Handoff:** the ordered list of what is still needed before submission, and the web/app separation contract, is `ios/AppStore/NEXT-STEPS.md`.

Implemented on `codex/ios-app-wrapper` and pushed with the account holder’s authorization. Vercel Preview is ready; production remains on `main`. The App Store Connect record was created on 15 September 2026: Memo AI, Apple ID `6812409212`, bundle `eu.memoai.memo`, primary language English (U.K.), SKU `memoai-ios`. A fresh signed archive and App Store distribution export include PWA theme synchronization, both login providers, the corrected launch screen, the Apple sign-in entitlement and all four subscription product IDs (`ios/build/MemoAI-settings-theme.xcarchive`, `ios/build/export-settings-theme`). Export verification confirmed the correct app/team, Apple sign-in entitlement, and disabled debugging. The account holder authorized pushing the test branch for its Vercel Preview on 15 September 2026. Production remains unchanged, and no build has been uploaded or submitted for review. Apple billing remains disabled in production. It is enabled only in the isolated staging Preview for Sandbox validation. Account setup and the release checks below must finish before production activation or submission.

The app supports iPhone and iPad on iOS 17+. It wraps the existing Memo app in WKWebView, opening `https://memoai.eu/auth/continue` to resume a session or show login directly. It adds native Sign in with Apple, Google sign-in through ASWebAuthenticationSession, StoreKit 2 subscriptions, native file sharing, camera/microphone permission prompts, and connection recovery. There are no native third-party SDK dependencies. The website and server changes in this branch must ship with the wrapper.

The follow-up privacy manifest declares UserDefaults reason `CA92.1` for the app-only theme preference, following [Apple’s required-reason API documentation](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype). Its signed archive passed (`ios/build/MemoAI-settings-privacy.xcarchive`). Distribution re-export still fails: with the Mac unlocked, Xcode returns “No Accounts” and no “iOS Distribution” certificate because no Apple ID is signed in under Xcode → Settings → Accounts (the keychain holds only an Apple Development identity). A signed Release archive of the current branch builds (`ios/build/MemoAI-release.xcarchive`); the export must be repeated after the account holder signs in. The earlier theme build exported successfully; it does not contain the later manifest, photo-library or edge-to-edge changes.

### App Store Connect setup in progress

- Created app `6812409212` and subscription group **Memo Premium** (`22387267`). Saved English (U.K.) group display name Memo Premium with app name Memo AI. The four plans are still at separate levels 1–4: Apple’s reorder control rejected the automated drag. The account holder has been asked to place all four at level 1; verification is pending.
- Created monthly product `eu.memoai.premium.monthly` (Apple ID `6812410886`, 1 month). Updated pricing on 16 September to €19.99 based on Slovenia, Apple's calculated regional equivalents, availability in all 175 storefronts, and English (U.K.) localization.
- Saved the monthly pay-up-front introductory offer starting 15 September 2026 with no end date in 175 storefronts. The confirmed table shows €9.99 for the first month in Slovenia, Croatia, Bosnia and Herzegovina and Serbia, then €19.99/month; other regional equivalents vary and are not all exactly 50%. The offer is saved, not tested in Apple Sandbox.
- Created yearly product `eu.memoai.premium.yearly` (Apple ID `6812422840`, 1 year). Account holder selected €129.99 because Apple does not offer an exact €130.00 price point. Saved pricing based on Slovenia with calculated regional equivalents and verified upfront annual availability in all 175 storefronts. Monthly billing with a 12-month commitment is not enabled.
- Saved the yearly pay-up-front introductory offer from 16 September 2026 with no end date across 175 storefronts. Slovenia, Croatia, Bosnia and Herzegovina and Serbia show €64.99 for the first year, then €129.99/year. Regional equivalents are not uniformly 50%; the app must use actual StoreKit prices and eligibility. Sandbox purchase verification remains pending.
- Saved English (U.K.) description, keywords, support/marketing URLs; saved subtitle and Education/Productivity categories. Saved the privacy-policy URL and app-review contact details. The support route still requires deployment.
- Account holder corrected Apple prices to **€19.99/month**, **€9.99 for the discounted first month**, **€129.99/year**, and **€64.99 for the discounted first year**. Both monthly renewal prices are now saved at €19.99, with Apple’s calculated regional equivalents. Discounted introductory prices and yearly prices remain as above.
- Small Business Program enrollment **submitted** on 15 September 2026 using the account holder's confirmed eligibility answers. Apple displayed “Thank you for your submission” and will email the decision. The reduced commission is not yet approved.
- Paid Apps Agreement accepted with the account holder's explicit confirmation. Existing legal entity address retained. The W-8BEN and separate U.S. foreign-status certificate were submitted with the account holder's explicit certifications and both are **Active**. On 16 September the Paid Apps Agreement and bank account both show **Active**.
- Revolut EUR payout account added with the account holder's confirmed deposit/reversal authorization and two-factor verification. Apple now shows **Active** (verified 16 September). The bank form rejected `Zgoša 87` as invalid; selected the entered ASCII spelling `Zgosa 87` instead of Apple's suggested `Zgosha 87`. The official business address remains **Zgoša 87, 4275 Begunje na Gorenjskem, Slovenia**. No banking numbers are stored in this repository.
- Created and downloaded the **Memo Billing Server** In-App Purchase key with the account holder's explicit confirmation. Its private key is stored outside Git with owner-only permissions; branch-scoped Preview server credentials are configured, with native Apple sign-in and billing enabled only on the staging Preview for integration checks. The separate Sign in with Apple key has also been created and securely stored. A private server environment file was prepared outside Git with both keys and a persistent token-encryption key; production remains disabled.
- Created monthly trial product `eu.memoai.premium.trial.monthly` (Apple ID `6812525834`) with English (U.K.) metadata, €19.99 renewal pricing (updated 16 September), availability in all 175 storefronts, and a saved three-day free introductory offer from 15 September 2026 with no end date. Created yearly trial product `eu.memoai.premium.trial.yearly` (Apple ID `6812531498`) with €129.99 renewal pricing, English (U.K.) metadata, annual upfront availability in all 175 storefronts, and a saved three-day free offer from 16 September 2026 with no end date.
- DAC7 information is **Active** as of 16 September. The account holder confirmed Memo supplies automated AI tools only, with no paid human services; the corresponding “No” answer was saved.
- Screenshots, review login and build upload are still pending. No app review submission or public release has occurred.
- Copyright saved as **2026 Memo AI, Nace Valenčič s.p., poslovno svetovanje**, matching the existing web legal operator. Manual release confirmed selected. Apple requires sole proprietors to enroll as Individuals and displays the owner's legal name as seller; see [Apple enrollment rules](https://developer.apple.com/help/account/membership/program-enrollment).
- EU trader contact form entered with the web app's published business address, `info@memoai.eu`, and the developer account's Slovenian phone number with the account holder's authorization. Apple requires all three contact fields for the public EU trader listing. Email and phone verification completed. Uploaded the official English AJPES extract for name and address evidence, then submitted the trader declaration with the account holder's explicit confirmation. Status is **In Review**, not approved.
- Streamlined Purchasing remains **on**: Apple refused to disable it until an approved binary includes `PurchaseIntent`. That API is now implemented locally; retry the setting after Apple accepts a qualifying build. Keep promotions, win-back offers and contingent pricing off. Test this workflow before release.

### Test preview (16 September 2026)

- Initial pushed commit: `a21096a704b5885370534da3163231b280422652`. Ready deployment after branch environment setup: `https://memo-17mthhtpy-nace-valencics-projects.vercel.app`.
- The three Supabase variables inherit global Preview scope, pointing to staging `yviipoccwsndxyrhtcjm`; no branch-specific Supabase overrides were created.
- Apple credentials and token-encryption material are server-only branch-scoped Preview variables. `APPLE_IAP_ENABLED=true` and `PREVIEW_AUTH_BYPASS=false` on the latest staging Preview only. Native Apple sign-in is enabled on Preview, and the staging Apple provider accepts `eu.memoai.memo`. The actual simulator login showed Google, Apple and email. Google opens its real system-browser authentication page. Apple returned simulator system error 1000; successful provider authentication remains unverified. The app was installed and launched on the account holder’s connected iPhone, but its authentication has not been completed.
- Latest verified billing-enabled preview: `https://memo-q7lkhqd22-nace-valencics-projects.vercel.app`, deployment `dpl_HHYnwGBmKuL4CUyR9uFm5HKpqE4R`, commit `6afed733`. The stable test alias is `https://memo-ai-git-codex-ios-app-wrapper-nace-valencics-projects.vercel.app`. Native loading-screen changes are in the local binary; this server deployment remains compatible. TLS-verified staging checks confirmed the entitlement ledger and both account-lifecycle tables exist with RLS enabled.
- Actual synthetic password login, AI-processing consent and all 23 onboarding steps passed in the iPhone simulator, including the demonstration quiz, practice answer and tutor controls. The real StoreKit paywall displayed three-day trials and opened Apple’s purchase sign-in dialog. A dedicated Slovenian Sandbox tester was created after the account holder restored the Apple session. The Sandbox tester email was verified successfully through Apple on 16 September; purchase retry is pending. No purchase has completed: Simulator previously returned AppleMediaServices authentication error 2 with an underlying password-reuse/account-state error. Physical-device purchase validation remains required. These onboarding demonstrations do not verify generated study content or the purchase lifecycle.
- Initial preview health and native-user-agent login requests returned HTTP 200. This is availability coverage, not an authenticated simulator walkthrough.

### Local verification (15–16 September 2026)

- The account holder requires the existing PWA experience throughout the wrapper. Removed the separate native paywall component: `OnboardingPaywall` and `DiscountOffer` now render the same PWA benefit cards, plan cards, offer sheet and CTA for iOS, backed by a shared Apple checkout hook. Prices, monthly/weekly equivalents and trial eligibility come from StoreKit; restore and renewal/legal links are added below the existing layout. The Apple offer does not show a false ten-minute expiry. TypeScript, lint, web build, native Debug build, 31 focused checks and all 1,346 web tests passed. The actual Preview passed simulator visual review of the shared paywall and half-price offer sheet; screenshots are `ios/build/screenshots/06-pwa-matching-paywall.png` and `07-pwa-matching-half-price-offer.png`. These show the simulator’s US storefront, not Slovenian EUR pricing.
- Settings keeps the PWA theme, subscription card, language/support/account rows and adds restore, Apple subscription management and AI-consent withdrawal using the same settings-row component styles. The installed wrapper hides the PWA installation guide. TypeScript, lint and the web build passed; the updated Preview shows the PWA theme/subscription/account layout in the simulator (`ios/build/screenshots/08-pwa-matching-settings.png`). The real Preview UI test passed on the iPhone simulator: settings scroll to Language, Restore purchases and Manage Apple subscriptions, and Light/Dark/System controls work. Native status-bar and safe-area appearance now follows the PWA theme and persists across launches. Screenshots are `ios/build/screenshots/09-settings-light.png`, `10-settings-dark.png`, and `11-settings-apple-rows.png`; result bundle is `ios/build/settings-scroll-review-4.xcresult`. This verifies navigation and appearance, not completed restore transactions.
- Login legal copy now uses the normal muted-text token instead of the disabled-text token. The actual updated login screen shows Google, Apple and email together; saved screenshot `ios/build/screenshots/05-login-all-providers.png`.
- Launch screen: replaced intrinsic-size launch art with a constrained storyboard; the runtime cover uses the same centered logo and Canvas token. The underlying web page stays hidden until navigation finishes. Debug build, signed Release archive and distribution export passed; actual simulator launch showed the loader and then all three login choices.
- Google native browser flow: 13 focused Google/Apple route and rendered login tests, TypeScript, changed-file lint and native Debug simulator build passed. Real Google completion remains pending.

- Web test suite after native Apple sign-in and encrypted authorization revocation: 1,328 passed, zero failed, including the offer guards. Focused offer, hydration and catalogue checks passed (15 tests).
- Web production build, TypeScript and changed-file ESLint: passed.
- Unsigned iOS Release build with Xcode 26.5: passed.
- Xcode account connected; signed Release archive and App Store distribution export passed (`ios/build/MemoAI.xcarchive`, `ios/build/export`). Export is local; this does not constitute App Store upload or review validation.
- Follow-up trusted-origin checks passed for production, staging and localhost; iPhone fixture UI tests, TypeScript and changed-file lint passed after the production redirect and PurchaseIntent changes.
- Native UI fixture tests: four passed on iPhone and four on iPad, iOS 26.5. The iPhone suite passed again after native Apple sign-in. A further iPad run passed all four wrapper tests after the offer changes. Catalogue checks and TypeScript also passed after removing web-only offer-expiry wording from the native wheel.
- StoreKit product-price/eligibility and stale-quote checks **passed in the Xcode IDE** after a normal debug launch initialized the local store. Command-line sessions on fresh iOS 26.5 simulators still fail with `SKInternalErrorDomain Code=3`; changing startup ordering and enabling simulator ad-hoc signing did not fix that. Xcode's test-control methods still report errors, including transaction enumeration: the returned empty transaction list is not reliable evidence. A native price bug was reproduced in the simulator: the yearly offer's numeric price was 64 while its display price was €64.99. The half-off badge now uses Apple's currency parser on the displayed offer price; the purchase quote includes displayed as well as numeric prices. The IDE run passed at 23:31 on 15 September 2026. An extended run at 23:38 passed all four products: both three-day trial products, both discounted products, and stale-quote rejection. The same test-control API warnings remained. This is local product presentation coverage, not Sandbox purchase/renewal/restore validation.
- Three-day trial presentation and signup-versus-wheel routing: 17 focused catalogue/product/subscription checks passed; TypeScript, changed-file lint and a native Debug simulator build passed (`ios/build/trial-routing-*.log`, `ios/build/trial-native-build.log`). The full web build also passed after these changes (`ios/build/trial-web-build.log`). Eight additional real-component rendering/provider and Apple-auth route checks passed (`ios/build/apple-login-screen-tests.log`), confirming the configured Apple button and email option render on the login screen. Both trial offers are saved in App Store Connect; real lifecycle tests remain outstanding.
- Sign-in by e-mail is by code only, on the web and in the app alike; the password screen that existed briefly for App Review was removed on 18 September 2026. Review and QA accounts (`APP_REVIEW_ACCOUNT_EMAILS`) accept the fixed `APP_REVIEW_LOGIN_CODE` in the ordinary code field and are never mailed (`src/lib/review-login.ts`, consumed by `/auth/email/verify` through an admin-issued magic link that never leaves the server).
- The actual authenticated PWA, Apple Sandbox purchase lifecycle, physical-device media, destructive account-deletion integration and App Store validation remain unverified.

### Additional release requirements confirmed by the account holder

- Launch directly into login for signed-out users; preserve automatic resume for signed-in users. `AppConfiguration.startURL` now opens `/auth/continue`; verified on the actual Preview in the iPhone simulator.
- Native Continue with Apple is implemented locally: nonce-bound identity verification, authorization-code exchange, encrypted server-only refresh-token storage, credential-revocation sign-out, and token revocation before account erasure. The Apple Developer portal now confirms Sign in with Apple is already enabled as a primary App ID on `eu.memoai.memo`. The dedicated Memo Apple Sign In key (`DG2SJQMW8J`) was created with the account holder’s confirmation and downloaded to secure storage outside Git. Preview server credentials and the staging provider are configured. Production configuration, real sign-in and deletion integration checks remain pending. Production stays disabled until configured and tested.
- Bring the 50% first-billing-cycle wheel offer to Apple billing and show the actual payable amount plus renewal price. The existing Stripe setup names `MEMO50` and `DAVID50`; inspect current configured codes before creating Apple equivalents. Apple offers require separate setup and real StoreKit validation. The native wheel now appears only when StoreKit reports an eligible half-price introductory offer. It shows Apple’s actual first-period and renewal prices and leads into the native paywall. The native offer has no fabricated countdown: Apple controls eligibility. The purchase rechecks the displayed quote and refuses changed terms. Both monthly and yearly App Store Connect introductory offers are saved; matching offer codes remain unconfigured. The local StoreKit test prices are fixtures, not live offers.
- The account holder also requires the web three-day trial. Inspection of the Stripe checkout confirms trial and wheel purchases are mutually exclusive: the wheel charges the discounted first period immediately and suppresses the trial. Native presentation now supports a StoreKit-reported three-day free trial with the renewal price and trial-specific CTA; a trial cannot qualify as a half-off wheel product. Ordinary signup now routes to `eu.memoai.premium.trial.monthly` / `eu.memoai.premium.trial.yearly`; the wheel routes to the existing monthly/yearly products. The two trial products MUST be created in the SAME Memo Premium group and at the SAME service level with three-day free introductory offers and the same renewal prices. Both trial records, three-day offers and renewal prices are saved. Their service levels still need alignment. Apple group eligibility prevents redeeming both introductory choices. Do not mark this requirement complete until real Apple eligibility and purchase flows pass. Apple permits one introductory offer per product/storefront and one redemption per subscription group ([Apple offer rules](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-introductory-offers-for-auto-renewable-subscriptions)).
- Click through the actual PWA in the iPhone/iPad simulator, including policies, auth, uploads, study tools, settings, purchases, restoration, discount eligibility and deletion. Existing fixture tests are not coverage of those flows.

### Full-screen app presentation

Memo uses a root WKWebView without an address bar, browser tabs or navigation toolbar. Its background fills the app window while content respects the iPhone camera/status area and home indicator. Link previews are disabled; deliberate external website links open in the system browser instead of an embedded Safari sheet. Google authentication and Apple billing retain their required system interfaces. The branch Preview now sets `VERCEL_PREVIEW_FEEDBACK_ENABLED=0` so Vercel’s review toolbar cannot overlay the app during review. The new deployment is ready. Native Debug build and the actual Preview simulator settings/theme/scroll test passed. Visually verified the toolbar is absent on home and settings. Fresh screenshots: `ios/build/screenshots/12-full-screen-home.png`, `13-full-screen-settings-light.png`, `14-full-screen-settings-dark.png`, and `15-full-screen-settings-apple.png`. The passing result bundle is `ios/build/browser-free-final.xcresult`. The UI test ran successfully while direct Mac control remained locked. A fresh distribution archive/export must include the browser-control changes before any upload.

### Language selection — same policy as the PWA

On the first online launch, the website’s existing IP-country lookup selects Slovenian for SI, Croatian for HR, Bosnian for BA and Serbian (Latin script) for RS. All other or unknown countries use English. The wrapper does not request GPS or replace this with the iPhone language/region. The first server-rendered login page uses the detected language and saves the regular `memo-locale` cookie in WKWebView’s persistent storage.

Manual language choices survive navigation and relaunch. Email, password and native Apple sign-in share the same account-language reconciliation: an existing profile preference wins, otherwise the detected/chosen language seeds the account. Native loading, retry and error messages follow the PWA’s `<html lang>` and saved cookie, including language changes while the app is open. Before the first country response, the launch overlay displays its image/spinner without a wrong-language loading sentence; a first-ever offline failure uses English because the country is unknown. Apple’s system-owned authentication, purchase and permission dialogs retain iOS-controlled localization.

Verification: 18 focused locale/auth/catalogue tests passed, covering native/PWA first-page parity for SI/HR/BA/RS, other/unknown countries, saved preferences and sign-in reconciliation. An iPhone simulator test passed all five languages through language changes, termination/relaunch and native connection-error/retry UI. These local checks do not replace the remaining real authenticated app and Apple Sandbox walkthrough.

### Full-screen web view and safe areas

The wrapper also removes WKWebView's keyboard accessory bar (previous/next/done) by giving the `WKContent…` view an `inputAccessoryView` of nil at runtime — there is no public switch for it — and upgrades the viewport meta to `viewport-fit=cover` if a page arrives without it.

The web view fills the window; there are no native safe-area bands. The page is served with `viewport-fit=cover` only to the native user agent (`generateViewport` in `src/app/layout.tsx`) and the document carries `data-native="ios"`, so the redesign's `--memo-safe-top` / `--memo-safe-bottom` variables (which are zero in browsers and the installed PWA) take the status bar and home indicator into account. In the app the home dock, the note dock and the sub-screen chat bar end about 35pt above the screen edge (`0.15rem` plus the bottom inset), matching where the installed web app shows them, because no browser bar runs under them; the note scroller reserves its 7rem plus the inset so flexible content such as the flashcard stage stays above the bar. The sign-in header has no back arrow because the landing page does not exist in the app. Any new fixed or sticky control near the screen edges must add the matching `--memo-safe-*` inset; check it in the simulator against a Preview, not only in a browser.

## 1. Find your Apple Team ID

1. Open [Apple Developer Account](https://developer.apple.com/account).
2. Sign in with the Apple Account whose Developer Program membership was approved.
3. Open **Membership details**.
4. Copy the **Team ID**: ten letters/numbers, for example `AB12CD34EF`.
5. Give the developer that ID. It is an identifier, not your password or a private key.

Apple confirms this location in its [Team ID reference](https://developer.apple.com/help/glossary/team-id/). The Team ID, bundle ID, and numeric App Store Apple ID are three different values.

## 2. Use the existing bundle ID

The account holder's Identifiers screenshot confirms `eu.memoai.memo` is already registered under team `J4PCHZ8P7T`, named **XC eu memoai memo**. The local project and server verification defaults now use that identifier. Do not register the earlier provisional `eu.memoai.app` identifier.

Open the existing `eu.memoai.memo` record to verify In-App Purchase is enabled. The `.local.nace` record is named for local development and the `.RecordingLiveActivity` records are named for extensions; this wrapper does not currently include those extensions. Preserve all existing identifiers.

An identifier record alone does not confirm an App Store Connect app record, configured subscription products, valid distribution signing or an uploaded build. Check the existing App Store Connect app before creating any record. [Apple app-record instructions](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app).

## 3. Create the App Store record and subscriptions

1. Open [App Store Connect](https://appstoreconnect.apple.com).
2. In **Business**, complete the Paid Apps Agreement and the required tax/bank details as Account Holder. Enter private financial details directly in Apple's portal. [Apple agreement instructions](https://developer.apple.com/help/app-store-connect/manage-agreements/sign-and-update-agreements).
3. In **Apps**, open the existing Memo app if present and confirm its bundle ID. Only if no app record exists, choose **+ → New App**: platform **iOS**, name **Memo AI** (subject to availability), primary language **English (UK)** or the business's preferred supported language, bundle **eu.memoai.memo**, SKU **memoai-ios**.
4. In **App Information**, copy the numeric **Apple ID** for the backend's `APPLE_APP_ID`.
5. In **Monetization → Subscriptions**, create one subscription group named **Memo Premium**.
6. Create these four auto-renewable subscriptions at the **same service level** in that group:

| Reference name | Exact product ID | Duration |
| --- | --- | --- |
| Memo Premium Monthly | `eu.memoai.premium.monthly` | 1 month |
| Memo Premium Yearly | `eu.memoai.premium.yearly` | 1 year |
| Memo Premium Trial Monthly | `eu.memoai.premium.trial.monthly` | 1 month |
| Memo Premium Trial Yearly | `eu.memoai.premium.trial.yearly` | 1 year |

7. Add localized display names/descriptions, availability, prices, and a screenshot showing the in-app subscription screen. The app displays Apple's actual localized price, not a hardcoded web price. Select prices deliberately; web discounts and trials are not automatically copied to Apple.
8. Leave Family Sharing and Billing Grace Period disabled. For the requested first-period discount, configure a pay-up-front introductory offer covering exactly one normal billing period (one month or one year) and test eligibility in Sandbox. Other introductory durations/payment modes deliberately make the native product unavailable until the paywall supports their terms. Grace-period access and family-sharing ownership are not implemented. Cancellation preserves access until the paid expiry; billing retry without a new paid period expires access.
9. Include all four products with the first app-version review submission. [Apple subscription setup](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/overview-for-configuring-in-app-purchases).

## 4. Configure server verification

An authenticated Memo user UUID becomes the StoreKit `appAccountToken`. The server verifies Apple's certificate chain and signed claims, checks that token against the signed-in user, and refreshes device receipts through Apple's API before granting access. The device finishes transactions only after server acceptance. Restoring a different Memo user's purchase fails rather than transferring access.

In App Store Connect, **Users and Access → Integrations → In-App Purchase**, create an In-App Purchase key. Securely save the `.p8`, key ID and issuer ID. Configure these as server-side environment variables, using `.env.production.example` as the reference:

- `APPLE_BUNDLE_ID=eu.memoai.memo`
- `APPLE_APP_ID`: numeric app record ID
- `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_PRIVATE_KEY`: Apple API credentials
- `APPLE_IAP_ENABLED=true`: only after configuration and validation
- `APPLE_SANDBOX_REVIEW_USER_IDS`: optional comma-separated UUIDs of explicitly chosen synthetic TestFlight/App Review accounts

Do not place secrets in Swift, `NEXT_PUBLIC_*`, Git, or chat. The [official Apple server library](https://github.com/apple/app-store-server-library-node) handles JWS verification and API authentication. Public root certificates in `src/lib/mobile/apple-roots.json` come from [Apple PKI](https://www.apple.com/certificateauthority/).

### Environment separation

- Vercel Production: `VERCEL_ENV=production`, production Supabase `zrcwmhuwwvguiekzmcdj`.
- Local/Vercel Preview: Apple's Sandbox and shared staging Supabase `yviipoccwsndxyrhtcjm` only. No branch-specific Supabase environment overrides.
- The backend rejects a mismatched database host. Apple billing disabled leaves existing web billing working normally.
- Real TestFlight/App Review use Apple's Sandbox even with the Release app pointed at production. Only explicitly allowlisted synthetic production accounts can receive those sandbox entitlements. Other production users can receive only production transactions. This exception does **not** authorize preview testing against production.
- Configure Notifications V2 production URL: `https://memoai.eu/api/mobile/notifications`. Use the staging preview URL for sandbox testing first. When validating the actual Release app for TestFlight/review, switch the sandbox notification URL to the production endpoint in a coordinated test window; only the allowlisted synthetic accounts are accepted there. Restore the intended sandbox target after the window. Never assume two independently configured sandbox webhook targets both receive events.
- Keep the chosen preview available to Apple, including its webhook. Vercel deployment protection can block device login and Apple callbacks; configure access deliberately for synthetic staging tests.

The existing migration `0024_mobile_app_store_entitlements.sql` supplies the entitlement ledger. The new `0050_account_deletion_queue.sql` migration supplies durable account erasure and the storage access guard. It has been replayed locally with all existing migrations and applied to **staging only** on 16 September 2026 as the serialized branch-testing exception. A TLS-verified schema query confirmed both new tables, enabled RLS, no browser-role table grants, and the restrictive storage guard. Shared staging temporarily includes this unmerged migration; restore the main baseline if this work is abandoned or changes incompatibly. Production has **not** received it. Verify the actual staging and production schemas contain that table before enabling billing. Do not run production migrations from this branch. Notification writes are monotonic and idempotent; the existing `0025` event-log table is not used by this implementation.

### Native Google sign-in configuration

The iOS login screen includes Google, Apple and email when their providers are configured. Google uses `ASWebAuthenticationSession`, because its OAuth flow cannot run inside WKWebView. The server starts PKCE in the app’s existing cookie jar and sets a ten-minute HTTP-only state cookie. The system browser returns only a one-use code via `eu.memoai.memo.auth://google/callback?state=…`; the app validates the callback and exchanges the code in the original cookie jar. Session tokens are never placed in a deep link. The server rejects cross-origin requests, mismatched state, deleting accounts and account switching, then applies the same language reconciliation as the other login methods.

Staging’s Supabase redirect allowlist includes `eu.memoai.memo.auth://google/callback**` alongside its existing entries. Enable `NATIVE_GOOGLE_SIGN_IN_ENABLED=true` only with the updated native binary and configured Google provider/callback. Configure and verify the production callback separately before release. The normal web Google flow remains unchanged.

### Native Sign in with Apple configuration

Enable Sign in with Apple on the existing `eu.memoai.memo` App ID, create a dedicated Sign in with Apple key, and regenerate the distribution profile. The IAP key is a different credential. Configure `APPLE_SIGN_IN_TEAM_ID`, `APPLE_SIGN_IN_KEY_ID` and `APPLE_SIGN_IN_PRIVATE_KEY` server-side. Set `APPLE_AUTH_TOKEN_ENCRYPTION_KEY` to 32 random bytes encoded as 64 hexadecimal characters; preserve it securely and never replace it without re-encrypting existing grants.

Enable the Apple provider in Supabase and include `eu.memoai.memo` in the accepted client IDs for native identity tokens. Preserve existing web client IDs and redirect configuration. Replay migration 0050 locally, follow the staging/merge workflow, and verify the `apple_auth_grants` table exists before enabling `APPLE_SIGN_IN_ENABLED`. The native server creates short-lived client-secret JWTs for authorization exchange and revocation; a static six-month client secret is not stored in this implementation.

Web Apple OAuth is separately gated by `APPLE_WEB_SIGN_IN_ENABLED` (default false). The web route (`src/app/auth/apple/route.ts`) and the login button already exist; turning them on is configuration only:

1. **Apple Developer → Identifiers → Services IDs → +**: create e.g. `eu.memoai.web`, enable Sign in with Apple, and under Configure choose the `eu.memoai.memo` App ID as primary, add the domains `memoai.eu`, `www.memoai.eu` and the Supabase auth host (`zrcwmhuwwvguiekzmcdj.supabase.co` for production, `yviipoccwsndxyrhtcjm.supabase.co` for staging), and the return URL `https://<project>.supabase.co/auth/v1/callback` for each project. Only the account holder can do this; there is no API for Services IDs.
2. **Client secret**: `node scripts/apple/web-client-secret.mjs eu.memoai.web` prints a six-month JWT signed with the existing Sign in with Apple key (`DG2SJQMW8J`, stored outside Git). Note the expiry it prints; Apple rejects secrets older than six months, so rotate before then.
3. **Supabase → Authentication → Providers → Apple** (staging first, then production): enabled; Client IDs `eu.memoai.memo,eu.memoai.web` (the bundle ID keeps native ID-token sign-in working, the Services ID serves the web); Secret Key = the JWT from step 2. Keep the existing redirect allowlist.
4. **Vercel**: set `APPLE_WEB_SIGN_IN_ENABLED=true` (Preview for the branch first, then Production). Nothing else changes; Google and email stay as they are.
5. **Verify on the Preview in Safari**: `/auth/continue` shows "Continue with Apple"; completing Apple's sheet lands on `/auth/callback` and then `/app`, with the same language reconciliation as Google; a repeat sign-in with the same Apple ID resumes the same Memo account. Check "Hide My Email" once, because Apple then issues a relay address.

Until step 1 exists the flag stays off and the web login is unchanged.

The encrypted grants are readable only by the service role and are bound to both user ID and Apple client ID. Do not put Apple tokens in user metadata, browser storage, logs or source control. Test account deletion, a failed revocation followed by a successful retry, and a credential revoked outside Memo.

## 5. Open and sign the Xcode project

From this task's checkout:

```sh
npm ci
npm run ios:open
```

1. In Xcode, **Settings → Accounts**, add the approved Apple Account if needed.
2. Open target **MemoAI → Signing & Capabilities**.
3. Leave **Automatically manage signing** enabled; select the approved team.
4. Confirm the bundle identifier is **eu.memoai.memo**.
5. Alternatively put `DEVELOPMENT_TEAM = YOURTEAMID` in ignored `ios/Config/Local.xcconfig`. Never commit private signing material.
6. Select your connected iPhone and run. Enable Developer Mode on the phone if Xcode asks.

Debug builds can set `MEMO_IOS_URL` in **Edit Scheme → Run → Arguments → Environment Variables** to `https://your-preview.vercel.app`. Only localhost/127.0.0.1 HTTP or Vercel HTTPS origins are accepted. Omit the path; the app opens `/auth/continue`, which resumes an existing session or shows login. Release builds always use `https://memoai.eu`.

The project and manifest generator is `python3 scripts/ios/create-project.py`; generated files and brand assets are checked in. Keep changes to generated configuration in that script as well. Version/build numbers live in `ios/Config/App.xcconfig`.

## 6. Test before release

```sh
npm test
npm run build
npm run ios:build
npm run ios:test
MEMO_IOS_TEST_DEVICE=iPad npm run ios:test
```

The native tests launch their own local synthetic fixture and isolated simulator (deleted again on exit). They cover launch, bridge injection, keyboard, HTTP-error retry, document download sharing and generated blob sharing. They do not exercise the real PWA, login, StoreKit purchases, recording, or server deletion.

The `testPreview*` cases in `WrapperTests` skip unless `MEMO_IOS_URL` names a Vercel Preview; run them through a user scheme (or `TEST_RUNNER_MEMO_IOS_URL`) against a simulator whose app is already signed in with a synthetic staging account. `testPreviewCreateStudyNoteFromPhoto` picks a lesson photo from the simulator library (`swift ios/build/make-study-fixture.swift`, then `xcrun simctl addmedia <udid> ios/build/synthetic-plant-lesson.png`), waits for the note, creates flashcards, a quiz and a mindmap, shares the mindmap PNG through the native sheet, chats, plays read-aloud and deletes the note. It consumes the account's one free note, so a full pass needs a fresh synthetic account. `testPreviewSignInScreenAndCodeLogin` runs on a signed-out simulator with `TEST_RUNNER_MEMO_QA_EMAIL`/`TEST_RUNNER_MEMO_QA_CODE` for a staging account listed in the Preview's `APP_REVIEW_ACCOUNT_EMAILS` (create one with the Supabase admin API against staging only). `testPreviewSafeAreaReview` only captures screenshots of the edge-to-edge layout for review. The test script uses the dedicated `MemoAIStoreTests` scheme with `ios/MemoAIUITests/Offers.storekit`; the normal `MemoAI` launch/archive scheme has no local StoreKit configuration. Test configuration prices (including €64.99 yearly introductory pricing) are synthetic and do not configure App Store Connect. `StoreOfferTests` exercises real StoreKit product loading, eligible first-period prices and rejection of a stale quote before a purchase starts. Run test commands sequentially because each uses this checkout's `ios/build` and fixture URL resource. Test artifacts and local signing files are ignored.

Required end-to-end checks with synthetic staging data:

- Email OTP sign-up, login, logout, relaunch, consent acceptance/decline/withdrawal, onboarding, and settings/account deletion access.
- Actual PWA on iPhone and iPad: light/dark, small screens, keyboard, VoiceOver, text scaling, rotation, permissions denied/allowed, camera/file uploads, recording, tutor audio and interruptions.
- Monthly/yearly purchase, cancellation, pending/Ask to Buy, renewal, expiry, refund/revocation, renewal failure/recovery, same-account restore, wrong-account restore, reinstall and offline purchase delivery retry.
- Apple notifications reach the endpoint and produce the expected ledger state. Test duplicate and out-of-order notifications. Verify purchases cannot overlap existing paid Stripe access.
- Delete synthetic accounts with files, failure captures, generated audio and subscriptions; verify storage, auth and related database rows. Verify another user's data remains. Test errors/retries and simultaneous requests from a second device.
- Account deletion atomically marks the auth account and queues erasure, then signs out. Server authentication rejects the marker; a restrictive storage policy blocks previously issued authenticated JWTs. Every server upload/copy and signed-upload issuance checks the owner immediately before each attempt. The every-three-hours authenticated `/api/cron/account-erasure` waits at least three hours for existing two-hour signed upload tokens and in-flight requests to drain, inventories failure-capture prefixes durably, erases storage, reconciles web subscription cancellations, deletes the auth account, and removes the queue row only after success. Partial failures retain the job for retry and report a cron error. Require `CRON_SECRET` and migration 0050 before rollout. Local PostgreSQL tests cover the drain, idempotence, role permissions, other-user isolation, and denial after auth deletion even when the queue row is gone. The cleanup engine also has passing local tests for storage outage retries, a crash after auth deletion, late-checkout reconciliation, and preserving other accounts. Actual staging races, long-running provider jobs and cleanup retry behavior still require integration verification before release.
- Test native Apple sign-in (including Hide My Email, first-time full name, cancellation, existing identities, nonce rejection and revoked credentials). Account erasure revokes every retained Apple grant before deleting auth; provider outages retain the erasure job for retry. If an older Apple identity has no retained token, deletion remains available and the confirmation links to Apple’s manual authorization-removal instructions. Verify this path against a synthetic legacy identity.

### Product and review limits

Recording relies on WKWebView and must be tested on a physical phone; background/locked-screen recording is not implemented. The app requires a network connection. Generated blob sharing has a 32 MiB cap. Extra voice-credit consumables are not offered in iOS. The account deletion screen explains that Apple subscriptions must be cancelled separately through Apple's subscription controls.

The native AI consent gate discloses Google Gemini, Soniox, OpenRouter and its model providers before the study screens open. Withdrawal stops subsequent normal app use; it does not cancel an already running job. The local legal catalogues now disclose OpenRouter and Apple transaction verification, distinguish web billing from App Store billing, and direct Apple cancellation/refund requests to Apple in all five languages. These updates still require deployment with this branch.

## 7. Archive, TestFlight, and submit

1. Ship the tested web/backend branch through the normal local → authorized push → Vercel Preview → authorized merge process. Confirm `memoai.eu` serves these changes. A local build alone does not update the wrapped website.
2. Complete the physical-device and Apple Sandbox checks above, then test the actual Release app using explicitly allowlisted synthetic accounts.
3. In Xcode select **Any iOS Device (arm64)** and **Product → Archive**.
4. In Organizer, **Validate App**, then **Distribute App → App Store Connect → Upload**. Use Apple's validation results as the final signing/package check.
5. Test the processed build through TestFlight before selecting it for the App Store version.
6. Complete the draft in `ios/AppStore/metadata.md`: accurate screenshots of the real app, category, age rating, availability, pricing, copyright/legal owner, privacy label, export compliance, contact details and review instructions.
7. Create and validate a dedicated synthetic review account: list it in `APP_REVIEW_ACCOUNT_EMAILS`, set `APP_REVIEW_LOGIN_CODE`, and give App Store Connect the e-mail as the user name and the code as the password. The reviewer signs in through the ordinary "Continue with email" flow. Do not store the code in this repository.
8. Select the build and all four subscriptions and submit only when all required fields/checks are complete.

Apple evaluates the app's utility and overall experience under [review guideline 4.2](https://developer.apple.com/app-store/review/guidelines/#minimum-functionality); native billing and sharing alone do not guarantee approval. Also check [account deletion requirements](https://developer.apple.com/support/offering-account-deletion-in-your-app), [privacy disclosures](https://developer.apple.com/app-store/app-privacy-details/), and [current submission requirements](https://developer.apple.com/app-store/submitting/).
