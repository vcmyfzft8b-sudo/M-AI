# App Review notes for 1.0 (paste into App Store Connect at submission)

Rewritten 27 Sep 2026 to answer App Review's Guideline 2.1 "Information Needed" request
(submission 767a42e7): Apple asked for the same answers in the Notes field for future submissions.
The reply that goes with the screen recording is in [app-review-2.1-reply.md](app-review-2.1-reply.md).
Characters: 3858 of 4000.

```text
SCREEN RECORDING: a recording from a physical iPhone on the latest iOS is attached to our reply in App Review messages. It starts at app launch and shows sign-up, a note, the paywall, both purchase flows and account deletion.

1. PURPOSE AND AUDIENCE: Memo is a study app for secondary-school and university students. A student records a lecture or adds material they already have (photos of pages, PDF, slides, audio, typed text or a link), and Memo turns it into private study notes, flashcards, a quiz, a mindmap and a voice tutor that talks the topic through. It saves the hours spent turning lectures into something to revise from.

2. SIGN-IN AND MAIN FEATURES: a fresh install opens onboarding. Tap Get started, answer the setup questions, go through the demos and tap Make my first note. At sign-in tap "Continue with email", enter the review e-mail from the sign-in information and tap Continue, then enter the six-digit code given as the password (a fixed code for this account; nothing is e-mailed) and tap Continue. No sample files are needed: the account already has the note "Plant Life Cycle" (fictional classroom material). Open it for the Notes, Flashcards, Quiz, Mindmap and Tutor tabs. The account has used its free note, so + (new note) opens the paywall.

3. ACCOUNT: registration is by e-mail code, Sign in with Apple or Google. Deletion: Settings > Delete account > Delete permanently. It runs in the app, ends access at once and removes all data within 24 hours; the screen explains that an Apple subscription must be cancelled through Apple.

4. CONTENT: everything a user creates is private to their account. There is no sharing, public profile, comment, feed or messaging between users.

5. IN-APP PURCHASE: one subscription group, Memo Premium, unlocking unlimited notes and 30 minutes of voice tutor a day. Monthly (1 month, 19.99 EUR / 19.99 USD) and Yearly (1 year, 129.99 EUR / 129.99 USD). The "Trial" products are the same plans with a 3-day free trial for new users; the non-trial products carry a half-price first period offered by the once-a-day wheel on the home screen and by creator codes (Settings > Redeem a code, e.g. MEMO50). Consumable "Tutor hour" (2.00 EUR) adds one hour of tutor time for subscribers: open "Plant Life Cycle" > Tutor tab > tap the clock-and-percentage meter below the tabs > Add an hour. The paywall opens from + (new note) or Settings > Choose a plan; it shows each plan's name, period and price, Restore Purchases and links to the Terms of Use and Privacy Policy. Settings also has Restore Purchases and Manage Apple subscriptions. Sandbox purchases by the review account are accepted.

6. EXTERNAL SERVICES: Supabase (sign-in, database, file storage), Vercel (hosting), Google Gemini (reading documents and photos, transcription, study content), OpenRouter (study content and answers), Soniox (speech recognition and tutor voice), Inngest (background jobs), Sentry (crash reports), Apple (StoreKit 2, Sign in with Apple, push notifications), Google Sign-In. The app asks permission before study material is sent to the AI providers.

7. REGIONS: the app works the same in every storefront. The only differences are the interface language (English, Slovenian, Croatian, Bosnian, Serbian) and Apple's local price per storefront.

8. REGULATION AND THIRD-PARTY MATERIAL: Memo is not in a regulated industry and supplies no third-party content. Users study material they provide themselves; a link import reads that page or video's captions only to make the user's own private note, and nothing is republished.

NATIVE: lectures keep recording with the screen locked (audio background mode, Live Activity clock); exports use the share sheet; the library works offline. Notifications are optional. Microphone: lectures and tutor; camera and photos: importing material and saving a mindmap image.
```
