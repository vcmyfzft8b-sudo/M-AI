# Memo iOS App Store Readiness

This checklist is scoped to the native iOS app in `ios/Memo`. It does not change the production web app at `https://memoai.eu`.

## Included In This Branch

- Native SwiftUI iOS target with bundle id `eu.memoai.memo`.
- App Store production URL setting uses `https://memoai.eu`.
- StoreKit 2 subscription purchase and restore flow.
- StoreKit local test products:
  - `eu.memoai.memo.weekly`
  - `eu.memoai.memo.monthly`
  - `eu.memoai.memo.yearly`
- Native Sign in with Apple entitlement and UI.
- Sign in with Apple sends a SHA-256 request nonce and passes the raw nonce to the Supabase token exchange.
- Keychain-backed session persistence.
- Microphone recording permission string.
- Camera scan permission string.
- Photo library import permission string.
- ATS stays HTTPS-only with no arbitrary load exception.
- Privacy manifest declaring linked email, user ID, purchase history, audio, photos/videos, user content, and unlinked crash data.
- Privacy manifest declares file metadata access under `NSPrivacyAccessedAPICategoryFileTimestamp` for app-container recordings/uploads and user-selected document metadata used by upload preparation.
- Export compliance flag set to `ITSAppUsesNonExemptEncryption=false` because the current native app only uses platform TLS/HTTPS and Apple frameworks, not custom encryption.
- Settings links for privacy policy, terms, support, restore purchases, Apple subscription management, and account deletion.
- The app calls the same production API routes as the website (bearer-authenticated
  through `getApiUser`), so notes, transcription, study material, quizzes,
  practice tests, chat and read-aloud all use the identical server pipeline.
- Mobile-only backend adapter under `ios/Memo/MobileBackend`, now limited to
  StoreKit entitlement sync and in-app account deletion.
- StoreKit signed transaction sync to `POST /api/mobile/storekit/verify`.
- Current StoreKit entitlements are synced to the mobile backend after email login, Apple login, session restore, purchase, restore, and delayed StoreKit transaction updates.
- App Store Server Notifications V2 endpoint at `POST /api/mobile/storekit/notifications`.
- Strict Apple JWS signature and certificate-chain verification in the mobile backend, configurable with Apple root certificates.
- Backend account deletion endpoint for the iOS app.
- Text/link/manual note creation, signed upload plus finalize for audio recordings, audio file imports, documents and scan sources, note deletion with storage cleanup, and grounded chat over stored notes — all through the production web routes.
- Study material, quizzes and practice tests are queued server-side by the production pipeline (citations, repair passes, quality gates and usage logging included); the workspace polls the note detail until each asset is ready.
- Native flashcard review flow with persisted Again/Good/Easy progress.
- Native quiz flow with hidden answers, per-question feedback, final score, and restart.
- Native practice-test flow with typed answers, answer-guide reveal, self-grading, progress, and restart.

## Must Be Finished Before App Review

### 1. App Store Connect Products

Create matching auto-renewable subscriptions in App Store Connect:

- `eu.memoai.memo.weekly`
- `eu.memoai.memo.monthly`
- `eu.memoai.memo.yearly`

Attach screenshots, localized display names, subscription group metadata, pricing, review notes, and sandbox test accounts. Replace the local StoreKit config values if final prices differ.

### 2. Apple Transaction Entitlement Sync

The branch includes an initial server-side entitlement path:

- iOS sends the signed App Store transaction JWS to the mobile backend.
- iOS also syncs already-active current entitlements after login/session restore so backend access is available on a new device or fresh install.
- iOS listens to delayed StoreKit transaction updates and syncs the signed transaction before finishing it.
- Backend validates the Supabase bearer token and checks the transaction payload fields.
- Backend verifies Apple JWS payloads against configured Apple root certificates in strict mode.
- Backend writes an Apple-backed `mobile_app_store_entitlements` row.
- App Store Server Notifications V2 can update existing Apple entitlement rows and writes notification audit rows.
- Existing web Stripe subscriptions remain valid for web users.
- The entitlement check should treat either active Stripe or active Apple entitlement as paid access.

Before submission, configure App Store Connect to send V2 notifications to:

```text
https://ios-api.memoai.eu/api/mobile/storekit/notifications?token=<MEMO_APP_STORE_NOTIFICATION_TOKEN>
```

Before production, set `MEMO_APP_STORE_NOTIFICATION_TOKEN`, set `MEMO_APP_STORE_JWS_VERIFICATION_MODE=strict`, and configure Apple root certificates with `MEMO_APPLE_ROOT_CERTIFICATES_PEM`, `MEMO_APPLE_ROOT_CERTIFICATES_BASE64`, or `MEMO_APPLE_ROOT_CERTIFICATES_PATH`. Use `decode-only` only for local Xcode StoreKit testing.

Still required for production hardening: App Store Server API notification-history recovery for missed delivery incidents.

Avoid reusing Stripe Checkout or Stripe Billing Portal in the iOS purchase flow.

### 3. Native Auth Contract

Web API routes authenticate through `getApiUser` (`src/lib/api-auth.ts`), which
accepts either the browser's Supabase cookies or an `Authorization: Bearer`
access token from the native client. Bearer requests have no RLS context, so the
converted routes use the service-role client with explicit `user_id` scoping.

The iOS project separates:

- Supabase RLS reads (library, folders, rename) through `SupabaseRESTClient`
- feature operations through `MemoAPIClient` against `/api/*`
- StoreKit sync and account deletion through `MemoAPIClient` against `/api/mobile/*`

Deploying the web app is therefore a prerequisite for the native app: the bearer
auth changes must be live before an App Store build can talk to production.

### 4. Upload Processing And Generation

Uploads and generation now run on the production pipeline, which already covers
queue-backed transcription, document extraction, scan OCR, TTS chunks, note media
and web-grade study generation. Remaining native-specific gap:

- long recordings are uploaded whole; the web client additionally splits them into
  processing chunks (`POST /api/lectures/:id/chunks`) before finalizing. The server
  falls back to the original file, so this is a throughput optimisation, not a
  correctness gap.

Server-side AI/transcription/OCR stays on the backend. The app does not depend on
long iOS background execution for generation.

### 5. Account Deletion

App Review expects users to be able to initiate account deletion in the app. The iOS UI now calls `DELETE /api/mobile/account`, which is designed to delete or schedule deletion for:

- Supabase Auth user
- profile
- lectures
- transcript segments
- notes/artifacts
- flashcards, quizzes, practice tests, study sessions
- chat messages
- uploaded storage objects
- generated TTS/audio objects

The app should also explain that App Store subscription cancellation is handled through Apple subscription management.

Before submission, deploy the mobile backend, apply the entitlement migration, and run a staging deletion test that proves Auth, relational rows, and Supabase Storage objects are removed.

### 6. Privacy And Legal

Confirm the public legal URLs exist before submission:

- `https://memoai.eu/app/support/privacy-policy`
- `https://memoai.eu/app/support/terms-of-use`
- `https://memoai.eu/app/support`

Review App Store privacy labels against production telemetry and SDKs. If Sentry, analytics, ads, attribution, or other SDKs are added to iOS later, update `PrivacyInfo.xcprivacy` and App Store Connect privacy answers.

### 7. Sign in with Apple

The native app includes Sign in with Apple and uses nonce-backed token exchange. Before release:

- enable Sign in with Apple for the app identifier in Apple Developer
- configure Supabase Apple provider for the iOS app
- handle private relay emails
- revoke Apple credentials as part of account deletion if required by the final auth setup

### 8. Background Modes

This project does not enable background modes. Add `UIBackgroundModes` only if Memo truly supports a background behavior, such as recording while the app is backgrounded. Avoid adding broad capabilities preemptively.

## Submission Notes

Use App Review notes to explain:

- Memo is an education/study productivity app.
- AI processing happens on Memo servers after user-initiated uploads.
- Quizzes and flashcards are generated study tools from the user's own uploaded or pasted study content.
- Practice tests are user-controlled study exercises; the app shows an answer guide after the user writes an answer and self-grades the attempt.
- iOS subscriptions use App Store in-app purchase.
- Existing web Stripe subscribers can log in, but new iOS purchases are not routed to Stripe.
- Uploaded content is private user study content and can be deleted with the account deletion flow.
