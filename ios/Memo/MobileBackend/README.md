# Memo iOS Mobile Backend

This is a separate deployable API adapter for the native iOS app. It does not change the production web app routes under `src/app/api`.

## Required Environment

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MEMO_STOREKIT_PRODUCT_IDS=eu.memoai.memo.weekly,eu.memoai.memo.monthly,eu.memoai.memo.yearly
MEMO_IOS_BUNDLE_ID=eu.memoai.memo
MEMO_APPLE_APP_ID=optional-production-app-apple-id
MEMO_APP_STORE_NOTIFICATION_TOKEN=required-shared-endpoint-token
MEMO_APP_STORE_JWS_VERIFICATION_MODE=strict
MEMO_APPLE_ROOT_CERTIFICATES_PEM=required-for-strict-mode
# or MEMO_APPLE_ROOT_CERTIFICATES_BASE64=
# or MEMO_APPLE_ROOT_CERTIFICATES_PATH=
GEMINI_API_KEY=optional
GEMINI_TEXT_MODEL=gemini-2.5-flash-lite
SONIOX_API_KEY=required-for-recording-transcription-and-tts
SONIOX_MODEL=stt-async-v4
SONIOX_TTS_MODEL=tts-rt-v1
```

## Endpoints

All non-health endpoints require `Authorization: Bearer <supabase_access_token>`.

```text
GET    /api/mobile/health
GET    /api/mobile/me
GET    /api/mobile/lectures
GET    /api/mobile/lectures/:id
DELETE /api/mobile/lectures/:id
POST   /api/mobile/lectures/manual
POST   /api/mobile/lectures/audio
POST   /api/mobile/lectures/document
POST   /api/mobile/lectures/scan
POST   /api/mobile/lectures/text
POST   /api/mobile/lectures/link
POST   /api/mobile/lectures/:id/finalize
PATCH  /api/mobile/lectures/:id/notes
POST   /api/mobile/lectures/:id/generate-study
POST   /api/mobile/lectures/:id/chat
PATCH  /api/mobile/lectures/:id/study-session
GET    /api/mobile/lectures/:id/tts/status
POST   /api/mobile/lectures/:id/tts/chunks
POST   /api/mobile/flashcards/:id/progress
POST   /api/mobile/storekit/verify
POST   /api/mobile/storekit/notifications
DELETE /api/mobile/account
```

The upload endpoints return Supabase signed upload targets. The iOS app uploads bytes directly to the returned `signedUrl`, then calls `POST /api/mobile/lectures/:id/finalize`.

The mobile backend owns the complete native processing pipeline. Recordings are transcribed with Soniox, while uploaded documents, scans, pasted text, and links are extracted directly by this service. Gemini creates the structured note artifact, flashcards, quiz questions, and practice-test prompts. Chat is grounded in the generated note, and native TTS is generated and cached through Soniox with the same daily quota model used by the app.

The iOS client uploads bytes directly to Supabase Storage and then polls `GET /api/mobile/lectures/:id` while native processing is in progress. None of these feature paths call the Memo web app or its Next.js API routes.

## Local Development

Pull the dedicated Vercel project's development variables into the ignored `.env.local`, then run the standalone development server. Debug iOS builds connect to this service at `http://127.0.0.1:8787/api/mobile`.

```sh
vercel env pull .env.local
npm install
npm run dev
```

Apply the mobile backend migrations to the production Supabase database before enabling StoreKit sync:

```text
migrations/0001_mobile_app_store_entitlements.sql
migrations/0002_mobile_app_store_notifications.sql
```

## StoreKit Notes

The iOS app sends StoreKit's signed transaction JWS after purchase, restore, session entitlement sync, and delayed transaction updates. This adapter stores the Apple entitlement separately from existing Stripe rows so web billing remains untouched.

Production StoreKit verification defaults to `MEMO_APP_STORE_JWS_VERIFICATION_MODE=strict`. In strict mode the backend validates the JWS `x5c` certificate chain against configured Apple root certificates, checks certificate validity dates, verifies the ES256 signature, and checks the bundle id plus optional App Apple ID. Provide Apple PKI root certificates through one of:

- `MEMO_APPLE_ROOT_CERTIFICATES_PEM`
- `MEMO_APPLE_ROOT_CERTIFICATES_BASE64`
- `MEMO_APPLE_ROOT_CERTIFICATES_PATH`

Use `decode-only` only for local StoreKit/Xcode testing when signed payloads are not chained to Apple production roots. Do not deploy production with `decode-only`.

Configure App Store Server Notifications V2 in App Store Connect with this HTTPS URL:

```text
https://ios-api.memoai.eu/api/mobile/storekit/notifications?token=<MEMO_APP_STORE_NOTIFICATION_TOKEN>
```

The notification endpoint requires the shared token, accepts Apple's V2 `signedPayload`, verifies it in strict mode, records each notification, and updates an existing Apple entitlement when the original transaction has already been linked to a Memo user by the iOS app. Keep the app-side purchase/restore sync active because unmatched server notifications cannot safely infer a user account by themselves.

For final production hardening, use App Store Server API notification history during incident recovery.

## Study Progress

`POST /api/mobile/flashcards/:id/progress` persists native flashcard review progress with the same `again`, `good`, and `easy` confidence buckets used by the web app. The endpoint verifies the flashcard belongs to one of the signed-in user's lectures before writing `flashcard_progress`.
