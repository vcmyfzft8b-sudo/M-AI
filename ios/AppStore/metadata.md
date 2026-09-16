# App Store listing draft — do not submit unchanged

## Public listing

- Name: **Memo AI** (app record created; Apple ID `6812409212`)
- Subtitle: **Notes, flashcards and quizzes**
- Primary category: **Education**
- Secondary category: **Productivity**
- Keywords: `study,lecture,notes,flashcards,quiz,transcription,revision,tutor,podcast`
- Support URL: `https://memoai.eu/support` (deploy this branch before use)
- Privacy policy: `https://memoai.eu/legal/privacy-policy`
- Terms: `https://memoai.eu/legal/terms-of-use`
- Support email: `info@memoai.eu`
- Copyright: **2026 Memo AI, Nace Valenčič s.p., poslovno svetovanje** (saved in App Store Connect, matching the web operator).

### Description

Turn lectures and study materials into notes you can use.

With Memo, you can record or upload your learning materials, create organized notes, review flashcards, test yourself with quizzes, and ask questions about what you are studying. Listen to your notes and explore your material with a voice tutor.

Your notes stay connected to your Memo account across supported devices. Share generated study materials using the iOS share sheet.

An internet connection and Memo account are required. AI-generated content may contain mistakes; check important information against your original materials.

Memo Premium offers monthly and yearly auto-renewable subscriptions. Available prices and billing periods appear in the app before purchase. Payment is charged to your Apple Account. Your subscription renews automatically unless cancelled at least 24 hours before the current period ends. Manage or cancel in your Apple Account subscription settings.

Privacy policy: https://memoai.eu/legal/privacy-policy
Terms of use: https://memoai.eu/legal/terms-of-use

## Screenshots to capture after real-device QA

Use synthetic learning materials in the actual app, with no customer information. Capture every device size App Store Connect requires for the supported iPhone/iPad families. Capture notes, flashcards, quiz, tutor and subscription screens; do not upload the automated test fixture. Confirm localized price, functionality and wording match the release build. Add subscription review screenshots separately for each product.

## App Review information — complete before submission

The account holder's authorized name, telephone and email have been saved in App Store Connect.

Draft review notes:

> Memo helps students turn their recordings and documents into notes, flashcards and quizzes. It supports study-content generation, audio tutoring and native file sharing. An internet connection is required.
>
> Tap "Continue with email", then the "Sign in with a password" link under the email field, and use the dedicated review account supplied in the sign-in information. [Labels verified on the staging Preview build on 16 September 2026 (`testPreviewSignInScreenAndPasswordLogin`); confirm the review account itself works in the Release build against production before saving these instructions.]
>
> The app requests explicit permission before sending study content to the disclosed AI providers. Account deletion and subscription management are in Settings. Deleting a Memo account does not cancel an Apple subscription; the app explains how to cancel it.
>
> Memo Premium Monthly and Yearly are auto-renewable products in one subscription group. Restore Purchases is available on the subscription screen and in Settings. Existing paid users can access their account without purchasing again.

Use an allowlisted synthetic account for Apple Sandbox purchases in the Release app. Verify that review login and subscription access work before writing that they work here.

## Privacy and compliance review

The app collects data through the embedded website and backend. **Do not select “Data Not Collected.”** The checked-in manifest includes account name/email/ID, purchases, uploaded audio/photos/documents and other content, support requests, usage and diagnostic data, and approximate location derived by analytics. It conservatively treats those categories as linked to the account.

Reconcile the manifest and App Store privacy answers against the deployed Supabase, AI, Sentry, Vercel analytics and support setup. Declare purposes, account linkage and retention accurately; confirm whether any optional data qualifies for an exception. No advertising identifier or cross-company advertising tracking is implemented in the wrapper. The absence of an ATT prompt is not permission to add tracking to the website.

Confirm the public privacy policy describes third-party AI processing, retention, account deletion and the actual business contact. Check the age-rating questionnaire based on actual AI/chat capabilities. Standard HTTPS/StoreKit encryption is declared in Info.plist; the account holder must answer export-compliance questions for the actual shipped app and distribution countries.

Full setup, remaining release blockers and validation steps: `docs/ios-app.md`.
