# App Review 2.1 "Information Needed" — reply and screen recording

App Review returned version 1.0 (build 21, submission `767a42e7`, submitted 26 Sep 2026) under
Guideline 2.1 because the developer account has a short review history. Nothing in the build was
rejected; Apple wants a device recording and seven answers, both in a reply and in the Notes field.

What is done and what is left:

| Step | Who | State |
| --- | --- | --- |
| Notes field in App Review Information rewritten with the answers ([review-notes-final.md](review-notes-final.md)) | agent, via the API | done 27 Sep |
| Record the app on a physical iPhone on the latest iOS (script below) | owner | to do |
| Reply in App Store Connect → App Review with the text below and the video attached | owner | to do |
| Resubmit: if the version still shows *Rejected* after the reply, add the four subscriptions and the Tutor hour to the submission again and press *Resubmit to App Review* | owner | to do |

Nothing in the app had to change. Checked against the build before writing the answers:

- **Account deletion** is in the app: Settings → Delete account → *Delete permanently* calls
  `/api/account/delete` and lands on `/auth/account-deleted` (the e-mail request is the web path only).
- **User-generated content**: notes are private to their account; there is no sharing, profile,
  comment or feed between users, so no reporting or blocking is required.
- **Paywall** (`onboarding-paywall.tsx`, `discount-offer.tsx`, `apple-code-form.tsx`) shows each plan's
  name, period and Apple price, and `AppleBillingTerms` puts Restore, Terms of Use and Privacy Policy
  under the button.

## Recording script (physical iPhone, latest iOS)

Apple wants it to **start at launch** and show the typical flow. Use a **new account** for
registration and deletion — never delete the review account, App Review signs in with it.

Before recording:

1. Update the iPhone to the newest iOS (Settings → General → Software Update).
2. Delete Memo AI from the phone, then install 1.0 (21) from TestFlight. TestFlight purchases run
   in the sandbox and cost nothing.
3. Have a fresh e-mail address ready (a `+memo-review` alias works) and a photo or PDF of a page of
   study material.
4. Turn on Do Not Disturb so no notification lands in the video. Add Screen Recording to Control
   Center if it is not there.

Record (one take; cutting only the wait while the note is generated is fine):

1. Start the screen recording, go to the home screen and **tap the Memo AI icon**.
2. Onboarding: *Get started*, answer the questions, swipe through the demos, *Make my first note*.
3. **Registration**: *Continue with email* → the new address → type the code from the e-mail →
   allow AI processing on the consent screen.
4. **First note**: + → *Photos* (or *PDF*) → pick the page → create. Cut the wait, then show the
   note: Notes, flip a Flashcard, answer a Quiz question, open the Mindmap, open the Tutor.
5. **Paywall**: tap + again (the free note is used) → the Memo Premium paywall. Hold for 3 seconds
   so both plan cards (name, period, price) are readable. Tap **Terms of Use**, show it, go back;
   tap **Privacy Policy**, show it, go back.
6. **Subscribe**: tap *Start the 3-day free trial* → hold on Apple's purchase sheet (title, period, price) →
   confirm → back in the app with Premium.
7. **Tutor hour**: open the note → Tutor tab → tap the clock-and-percentage meter under the tabs →
   *Add an hour for €2.00* → Apple's sheet shows the price → confirm or cancel.
8. **Settings**: show the Subscription card, *Manage Apple subscriptions*, *Restore purchases* and
   *Redeem a code*.
9. **Account deletion**: Settings → *Delete account* → read the sheet → *Delete permanently* →
   the "account deleted" screen.
10. Stop the recording.

If the video is too large to attach to the reply, trim it in Photos or send it as a shared
iCloud Drive link in the reply instead.

## Reply to paste in App Store Connect

App Store Connect → Memo AI → the App Review message for submission `767a42e7` → Reply. Attach the
recording.

```text
Hello,

Thank you for the review. The attached screen recording was captured on a physical iPhone running the latest iOS. It starts at app launch and shows registration and sign-in, making a note and using its study tools, the subscription paywall and purchase, the Tutor hour purchase, and account deletion. Answers to your questions follow, and we have added the same information to the Notes field of App Review Information.

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

## Known risk not raised by this request

The yearly card's large figure is the monthly equivalent, with "billed yearly: €129.99" beneath it
(chosen in #497). Guideline 3.1.2(c) asks for the billed amount to be the most prominent price, so a
later reviewer may raise it once they see the paywall in the recording. It was left as chosen.

