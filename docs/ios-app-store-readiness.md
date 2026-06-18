# iOS App Store Readiness

The iOS app lives in `ios-app` and is separate from the normal Next.js web build.

## Implemented In This Branch

- Separate Capacitor iOS project under `ios-app`.
- Native StoreKit bridge for product lookup, purchase, and restore.
- Native iOS user-agent token: `MemoAIiOS/1.0`.
- StoreKit purchases include the Memo user UUID as `appAccountToken`.
- Web paywall remains Stripe by default, but switches to App Store purchase in the iOS shell.
- Stripe checkout and billing portal API routes reject requests from the Memo iOS user agent.
- Server endpoint verifies App Store signed transactions before granting access.
- Server endpoint verifies App Store Server Notifications for subscription lifecycle updates.
- The iOS paywall shows auto-renewal, Apple ID billing, subscription-management, terms, and privacy disclosures.
- Account deletion is available from settings and removes known stored lecture objects plus user-linked usage, email-code, and rate-limit rows before deleting the auth user.
- Account deletion warns iOS users that deleting the Memo account does not cancel an App Store subscription.
- iOS settings hide Stripe-only redeem-code entry and link subscription management to Apple.
- iOS support pages hide direct Stripe Checkout and promo-code instructions.
- iOS authentication hides Google sign-in if Google is the only enabled provider, so App Review always sees an email or Apple login alternative when third-party login is available.
- iOS permission strings are present for camera, microphone, photos, and documents.
- The iOS target includes `PrivacyInfo.xcprivacy` with tracking disabled, collected-data declarations, and required-reason API declarations for the native shell.
- Public support and privacy URLs are available for App Store Connect metadata:
  - `https://memoai.eu/support`
  - `https://memoai.eu/legal/privacy`
  - `https://memoai.eu/legal/terms`
- Native app icon and splash assets are Memo-branded, not Capacitor placeholders.
- `npm run ios:verify` checks source-level iOS readiness gates that can run without Xcode signing.
- App Store Connect review-note and privacy-label drafts live under `ios-app/docs`.

## Still Required Before Submission

- Install full Xcode and select a real Apple Developer Team.
- Enable In-App Purchase capability in the Xcode target.
- Create App Store Connect subscription products matching the configured product IDs.
- Configure Apple transaction verification env vars in Vercel production.
- Configure App Store Server Notifications to `https://memoai.eu/api/billing/apple/notifications`.
- Set App Store Connect support URL to `https://memoai.eu/support`.
- Set App Store Connect privacy policy URL to `https://memoai.eu/legal/privacy`.
- Use `https://memoai.eu/legal/terms` for the app's terms URL where App Store Connect or subscription metadata asks for it.
- Confirm Supabase auth redirect URLs work inside the iOS WebView.
- Confirm the submitted iOS build has a working email or Apple login path. If Google login is enabled, keep email or Apple enabled too.
- Test signup, login, onboarding, purchase, restore, note creation, account deletion, and logout in TestFlight.
- Fill App Store Connect privacy labels accurately.
- Reconcile the App Store Connect privacy labels with `ios-app/ios/App/App/PrivacyInfo.xcprivacy`.
- Provide App Review credentials and notes for any paid or gated feature.
- Run `npm run ios:verify` before archiving.

## Review Risks To Keep Guarded

- Do not show Stripe Checkout, promotion code redemption, or external purchase calls to action inside the iOS shell.
- Keep the server-side iOS guard on Stripe checkout and billing portal routes.
- Keep restore purchases visible anywhere users can buy subscriptions.
- Keep auto-renewal, Apple ID billing, subscription-management, terms, and privacy disclosures visible on the iOS subscription paywall.
- Keep account deletion accessible without emailing support and keep storage plus residual database cleanup wired into the delete endpoint.
- Keep the account deletion warning clear that App Store subscriptions are managed separately by Apple.
- Keep privacy policy and terms reachable from signup/settings.
- Do not ship an iOS build where Google is the only usable login method; keep email or Apple login available for App Review.
- Make sure uploaded study material is user-provided or user-authorized, as stated in the existing terms.

Primary Apple references:

- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- App Review preparation: https://developer.apple.com/distribute/app-review/
- Sign in with Apple guidance: https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple
- StoreKit: https://developer.apple.com/documentation/storekit
