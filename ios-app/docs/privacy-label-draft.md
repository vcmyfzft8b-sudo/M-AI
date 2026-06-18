# App Privacy Label Draft

Use this as a draft when completing App Store Connect privacy labels. The final answers must match the production configuration at submission time.

## Data Linked To The User

- Contact Info: email address for authentication and account communication.
- User ID: Supabase/auth user identifiers and app profile records.
- Purchases: App Store subscription transaction identifiers and entitlement state.
- User Content: uploaded documents, pasted text, public links submitted by the user, generated notes, flashcards, quizzes, practice tests, and chat prompts/messages.
- Audio Data: microphone recordings and uploaded audio used for transcription and note generation.
- Photos or Videos: selected images/scans uploaded by the user for note generation.
- Product Interaction: app usage events needed for functionality, diagnostics, abuse prevention, and analytics if enabled.

## Data Not Used For Tracking

The iOS app should not use collected data to track users across apps and websites owned by other companies. Keep `NSPrivacyTracking` false unless a future change introduces tracking.

## Diagnostics

- Crash Data: Sentry/Apple diagnostics if enabled in the submitted build.
- Performance Data: diagnostics and operational telemetry if enabled in the submitted build.

## Required Reason APIs

`ios/App/App/PrivacyInfo.xcprivacy` declares required-reason API usage for the native Capacitor/WebView shell:

- User Defaults: `CA92.1`
- File Timestamp: `C617.1`
- Disk Space: `E174.1`
- System Boot Time: `35F9.1`

Re-check the Xcode privacy report before submission. If App Store Connect reports another required-reason category after archive upload, reconcile the report with this file before review.

## Purpose

Primary purpose is app functionality:

- account login and session management
- storing the user's note library
- transcribing and processing user-provided materials
- generating study notes, flashcards, quizzes, practice tests, and chat answers
- subscription entitlement management
- abuse prevention, rate limiting, and diagnostics

Analytics may apply only if analytics/monitoring is enabled in production.

## Cross-Check Before Submission

- App Store Connect privacy labels match `ios/App/App/PrivacyInfo.xcprivacy`.
- Privacy Policy URL: `https://memoai.eu/legal/privacy`.
- Support URL: `https://memoai.eu/support`.
- Privacy policy in the app explains AI processing and third-party processing.
- App Review demo account can access Settings, privacy policy, terms, account deletion, and purchase/restore flows.
- Account deletion should be tested with at least one uploaded note so storage cleanup is exercised.
