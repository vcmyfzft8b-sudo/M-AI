# App Review Notes Draft

Use this as the starting point for the App Review Information section in App Store Connect.

## Demo Account

Provide a real reviewer account before submission:

- Email: `<reviewer account email>`
- Login method: email magic link or Apple. Google can also be enabled, but do not submit a Google-only iOS login configuration.
- Password: not applicable for magic-link accounts.
- Subscription state: either already active, or use the attached App Store sandbox tester and in-app purchase products.
- Sandbox Apple ID: `<sandbox tester Apple ID>` if App Review should exercise a fresh purchase.

Do not submit without a working account if App Review cannot reach the gated note-creation flow.

## Reviewer Instructions

1. Open the app.
2. Create or sign in to the demo account.
3. Complete onboarding.
4. On the paywall, choose a monthly or yearly plan.
5. The iOS build uses Apple in-app purchase via StoreKit. It does not use Stripe Checkout in the iOS shell.
6. To test purchase restoration, open Settings and use the restore purchase action from the paywall, or open Apple subscription management from Settings after purchase.
7. To test core functionality, create a note from text, PDF, audio, scan/photo, or a public link.
8. To test account deletion, open Settings and select the delete-account action.

## Compliance Notes

- Production domain: `https://memoai.eu`.
- Public support URL: `https://memoai.eu/support`.
- Public privacy policy URL: `https://memoai.eu/legal/privacy`.
- Public terms of use URL: `https://memoai.eu/legal/terms`.
- Bundle ID: `eu.memoai.app`.
- The iOS shell appends `MemoAIiOS/1.0` to the user agent so the web UI can show StoreKit purchase controls.
- StoreKit purchases include the Memo user UUID as Apple's `appAccountToken` for entitlement reconciliation.
- App Store Server Notifications are handled at `https://memoai.eu/api/billing/apple/notifications`.
- Stripe Checkout, promotion-code redemption, and external purchase instructions are hidden from the iOS shell.
- If Google login is enabled, the iOS shell keeps email or Apple login available as the equivalent sign-in option.
- The app includes account deletion from Settings and removes known stored lecture/audio/media objects plus user-linked operational rows before deleting the auth user.
- If a user has an active App Store subscription, account deletion warns that the Apple subscription must be managed separately through App Store settings.
- The app includes restore purchases on the native paywall flow.
- The iOS paywall states that subscriptions auto-renew, bill through Apple ID, and can be managed or canceled through App Store settings.
- The app includes privacy strings for camera, microphone, photos, and document access.
- The app includes `PrivacyInfo.xcprivacy`; App Store Connect privacy labels must be kept consistent with it.

## Content Rights And AI Notes

Memo AI is a user-directed study tool. Users upload or record their own study material and must have permission to use that material. Terms and privacy policy are available from signup and Settings.

The app may process user-provided audio, documents, text, images, and prompts with AI/infrastructure providers to generate notes, transcripts, quizzes, flashcards, and chat answers.

## Before Submission

- Confirm the demo account can sign in on the submitted build.
- Confirm email or Apple login works in the submitted iOS build. Do not submit with Google as the only enabled login provider.
- Confirm App Store Connect products exist:
  - `eu.memoai.pro.monthly`
  - `eu.memoai.pro.yearly`
- Confirm the reviewer account and sandbox tester can complete at least one purchase in the submitted build.
- Confirm Apple transaction verification env vars are configured on `https://memoai.eu`.
- Confirm App Store Server Notifications are configured to `https://memoai.eu/api/billing/apple/notifications`.
- Confirm App Store Connect support URL is `https://memoai.eu/support`.
- Confirm App Store Connect privacy policy URL is `https://memoai.eu/legal/privacy`.
- Confirm subscription metadata links to `https://memoai.eu/legal/terms` where terms are requested.
- Confirm no Stripe Checkout page appears inside the iOS shell.
- Confirm account deletion works end to end.
- Confirm account deletion warning appears for accounts with active subscriptions.
