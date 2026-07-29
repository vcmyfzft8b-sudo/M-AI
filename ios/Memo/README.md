# Memo iOS

This folder contains a separate native SwiftUI translation of Memo for iOS.
It is intentionally isolated from the Next.js web app: no existing web source, package, Supabase migration, or deployment file is changed to build the iOS target.

## Open And Build

Open the project in Xcode:

```bash
open ios/Memo/Memo.xcodeproj
```

Command-line simulator build:

```bash
xcodebuild -project ios/Memo/Memo.xcodeproj -scheme Memo -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

## Current Native Surface

- Email code login through Supabase Auth
- Native Sign in with Apple through `AuthenticationServices` with nonce-backed Supabase token exchange
- Onboarding fields matching the web profile schema
- StoreKit 2 paywall, purchase, restore, and current-entitlement checks
- StoreKit signed transaction sync to the separate mobile backend after purchase, restore, login, session restore, and delayed transaction updates
- App Store Server Notifications endpoint for Apple subscription renewal/refund/revocation updates
- Library and folder reads through Supabase RLS
- Lecture detail tabs for notes, transcript, flashcards, quiz, chat, and share/export text
- Native generated-notes editing through the separate mobile backend
- Note read-aloud with play, pause, resume, word alignment, voices, quota, and cached audio from the same streamed TTS API as mobile web
- Interactive flashcard review with Again/Good/Easy progress saved through the mobile backend
- Native flashcard and quiz management (create, edit, search, and delete) through authenticated mobile API equivalents of the web routes
- Interactive quiz flow with hidden answers, per-question feedback, scoring, and restart
- Interactive practice-test flow with typed answers, answer-guide reveal, self-grading, progress, and restart
- Create-note UI for audio recording, audio file import, pasted text, link, document, scan images, and manual drafts
- Signed upload/finalize flow for audio recordings, imported audio files, documents, and scan images
- Mobile source extraction and study-material generation for notes, flashcards, quiz, and practice-test prompts
- Settings with legal links, Apple subscription management, restore purchases, sign out, and backend account deletion
- App Store metadata scaffolding: Info.plist permission strings, Sign in with Apple entitlement, privacy manifest with required-reason API declarations, StoreKit test config, and complete app icon set
- Separate deployable mobile backend at `ios/Memo/MobileBackend`

## Required Local Configuration

The Xcode target has these build settings:

- `MEMO_SITE_URL=https://memoai.eu`
- Debug: `MEMO_MOBILE_API_URL=http://127.0.0.1:8787/api/mobile`, served from `ios/Memo/MobileBackend`
- Release: `MEMO_MOBILE_API_URL=https://ios-api.memoai.eu/api/mobile`
- `MEMO_SUPABASE_URL`
- `MEMO_SUPABASE_ANON_KEY`
- `MEMO_STOREKIT_PRODUCT_IDS=eu.memoai.memo.weekly,eu.memoai.memo.monthly,eu.memoai.memo.yearly`

Set `MEMO_SUPABASE_URL` and `MEMO_SUPABASE_ANON_KEY` in the Xcode build settings or an `.xcconfig` file before testing with a real account.

To run the independent backend locally, link its Vercel project, pull its development environment into an ignored `.env.local`, and start its standalone Node server on port 8787:

```bash
cd ios/Memo/MobileBackend
vercel link
vercel env pull .env.local
npm install
npm run dev
```

## Important Integration Boundary

The web app uses its own cookie-session API routes. The iOS app does not call them. It keeps direct user-owned reads in `SupabaseRESTClient` and routes privileged operations through `MemoAPIClient` to the separately deployed `ios/Memo/MobileBackend` service.

The mobile backend covers bearer authentication, text/link/manual note creation, signed upload/finalize for audio/document/scan sources, Soniox transcription and speech generation, Gemini extraction and study generation, editable note documents and photos, flashcards, quizzes, practice tests, grounded chat, note deletion with storage cleanup, StoreKit receipt persistence with strict Apple JWS verification, token-gated App Store Server Notifications intake, and account deletion. Read-aloud audio, caching, word timing, quota, and usage are all handled by this independent service; playback remains native through `AVPlayer`.

Do not point iOS subscription purchase buttons to Stripe Checkout. iOS purchases must use StoreKit / App Store in-app purchase unless an Apple-approved external purchase entitlement is granted.

See [Docs/AppStoreReadiness.md](/Users/nacevalencic/Desktop/note_taking_app_slo/ios/Memo/Docs/AppStoreReadiness.md) for the acceptance checklist and backend requirements.
