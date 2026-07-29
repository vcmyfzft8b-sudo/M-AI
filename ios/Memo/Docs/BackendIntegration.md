# Native Backend Integration

The iOS app calls the **same API routes as the website**. There is no separate
feature backend for mobile any more: notes, transcription, study material,
quizzes, practice tests, chat and read-aloud all run through the production
pipeline in `src/app/api/*`. Only App Store specific work (StoreKit entitlement
sync and in-app account deletion) stays on the mobile adapter under
`ios/Memo/MobileBackend`, mounted at `/api/mobile/*`.

## Authentication

Web routes previously authenticated only through Supabase auth cookies. They now
use `getApiUser(request)` (`src/lib/api-auth.ts`), which accepts either:

- the browser's Supabase auth cookies, or
- an `Authorization: Bearer <supabase access token>` header, which is what the
  native client sends.

Because a bearer request has no cookie-backed RLS context, converted routes read
and write through the service-role client and scope every query explicitly with
the authenticated `user.id` (`ensureUserOwnsLecture`, `.eq("user_id", user.id)`).

## Routes The App Uses

```text
GET    /api/lectures/:id                                  note detail (polled while processing)
DELETE /api/lectures/:id                                  delete note
POST   /api/lectures/:id/retry                            retry failed processing
POST   /api/lectures                                      create audio note + signed upload target
POST   /api/lectures/:id/finalize                         start audio processing
POST   /api/lectures/manual                               draft note (text | pdf | link)
POST   /api/lectures/text                                 pasted text
POST   /api/lectures/link                                 web link
POST   /api/lectures/pdf                                  multipart document upload
POST   /api/lectures/:id/scan-uploads                     signed upload targets for photos
POST   /api/lectures/scan                                 queue photo/OCR processing
POST   /api/lectures/:id/study                            queue flashcards + study material
POST   /api/lectures/:id/quiz                             queue quiz generation
POST   /api/lectures/:id/practice-test/attempt            start a practice attempt
POST   /api/lectures/:id/practice-test/attempt/:id/submit grade an attempt
POST   /api/lectures/:id/chat                             grounded chat
PATCH  /api/lectures/:id/notes-doc                        highlights/underlines + photo blocks
POST   /api/lectures/:id/note-media/uploads               signed upload for an inline photo
POST   /api/lectures/:id/note-media                       attach uploaded photo
DELETE /api/lectures/:id/note-media/:mediaId              remove inline photo
PATCH  /api/lectures/:id/study-session                    persist study session state
GET    /api/lectures/:id/tts/status                       read-aloud quota/availability
POST   /api/lectures/:id/tts/chunks                       read-aloud audio chunk
POST   /api/lectures/:id/flashcards                       create flashcard
PATCH  /api/flashcards/:id                                edit flashcard
DELETE /api/flashcards/:id                                delete flashcard
POST   /api/flashcards/:id/progress                       Again / Good / Easy
POST   /api/lectures/:id/quiz/questions                   create quiz question
PATCH  /api/lectures/:id/quiz/questions/:questionId       edit quiz question
DELETE /api/lectures/:id/quiz/questions/:questionId       delete quiz question
POST   /api/profile/onboarding                            onboarding answers
```

Library lists, folders and note renames read/write Supabase directly through
`SupabaseRESTClient` with the user's own token, so RLS applies.

Generation is asynchronous, exactly as on the web: the POST queues work and
returns `{ ok: true }`, and the workspace polls `GET /api/lectures/:id` until the
asset status becomes `ready`.

## Uploads

The app never receives service-role keys. It asks the API for a signed upload
target (`path` + `token`), builds the Supabase upload URL the same way the web
client does
(`<supabase>/storage/v1/object/upload/sign/lecture-audio/<path>?token=…`), PUTs
the bytes, then calls the matching finalize/queue route.

## Mobile Adapter (`/api/mobile/*`)

Still used by the app:

```text
POST   /api/mobile/storekit/verify         sync a signed StoreKit transaction
POST   /api/mobile/storekit/notifications  App Store Server Notifications V2
DELETE /api/mobile/account                 in-app account deletion (Apple 5.1.1(v))
```

`ios/Memo/MobileBackend/src/handler.ts` still contains an older, self-contained
reimplementation of note creation, study generation, chat and TTS behind
`/api/mobile/lectures/*` and `/api/mobile/flashcards/*`. The app no longer calls
any of it; those handlers are billing-gated but redundant and can be deleted in a
follow-up cleanup.

Apply the mobile backend migrations before enabling StoreKit sync:

- `ios/Memo/MobileBackend/migrations/0001_mobile_app_store_entitlements.sql`
- `ios/Memo/MobileBackend/migrations/0002_mobile_app_store_notifications.sql`

## Entitlements

iOS purchase state stays separate from Stripe:

- Stripe subscriptions continue to populate existing web billing records.
- App Store transactions populate `mobile_app_store_entitlements`.
- Access is allowed when either a Stripe or an App Store entitlement is active.

Implemented notification path:

- App Store Server Notifications V2 endpoint at `/api/mobile/storekit/notifications`
- endpoint-token gate through `MEMO_APP_STORE_NOTIFICATION_TOKEN`
- strict Apple JWS verification for StoreKit transactions, notification payloads, and renewal info
- Apple `x5c` chain validation against configured Apple root certificates
- notification audit rows in `mobile_app_store_notifications`
- entitlement updates for notifications whose original transaction was already linked by the app

Required production configuration:

- `MEMO_APP_STORE_JWS_VERIFICATION_MODE=strict`
- `MEMO_APP_STORE_NOTIFICATION_TOKEN`
- `MEMO_APPLE_ROOT_CERTIFICATES_PEM`, `MEMO_APPLE_ROOT_CERTIFICATES_BASE64`, or `MEMO_APPLE_ROOT_CERTIFICATES_PATH`
- `MEMO_IOS_BUNDLE_ID=eu.memoai.memo`
- `MEMO_APPLE_APP_ID` after the App Store Connect app record exists

Still required for production hardening: App Store Server API notification-history
recovery for missed delivery incidents.

## Billing Responses

Feature routes answer HTTP 402 with `{ error, code, redirectTo }` when a paid
plan is required. The web client redirects to the paywall page; the native client
turns the same response into `MemoError.billingRequired` and presents the
StoreKit paywall.

## Account Deletion

`DELETE /api/mobile/account` removes lecture storage objects, deletes mobile App
Store entitlement rows, removes billing/profile/lecture data for the user, and
calls Supabase Auth Admin deletion.

Before App Review, test this against a staging Supabase project with realistic
uploaded files and confirm all storage paths are removed.
