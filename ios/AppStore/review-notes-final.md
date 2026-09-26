# App Review notes for 1.0 (paste into App Store Connect at submission)

Apply with the final build attached. Characters: 3697 of 4000.

```text
Memo helps students turn their recordings and documents into notes, flashcards and quizzes. It supports study-content generation, an audio tutor and native file sharing. An internet connection is required.

NATIVE FEATURES IN THIS BUILD: lectures are captured by the app itself on an AVAudioSession with the audio background mode, so recording continues with the screen locked, and a Live Activity shows a running clock on the Lock Screen for the whole lecture. Sign in with Apple uses the native credential, purchases use StoreKit 2, exports open the iOS share sheet, and the library can be read with no connection.

SIGN-IN: a fresh install starts with the same onboarding as the PWA. Tap Get started, answer the setup questions, continue through the study-tool demos, then tap Make my first note. At sign-in, tap "Continue with email", enter the review e-mail from the sign-in information and tap Continue. On the next screen enter the six-digit code given as the password (this review account uses a fixed code instead of an e-mailed one), then tap Continue. Google and Sign in with Apple are also offered; e-mail sign-in is by code, the same as on the web, and there is no password screen.

The review account already contains one generated note ("Plant Life Cycle", fictional classroom material) with notes, flashcards, a quiz, a mindmap and a tutor. The account has used its free note, so creating another one opens the Memo Premium paywall.

PURCHASES: Memo Premium Monthly / Yearly (3-day free trial products for ordinary sign-up; the discount wheel on the home screen offers the half-price first-period products) are auto-renewable subscriptions in one group. Sandbox purchases made by this review account are accepted by the server. Restore Purchases is on the subscription screen and in Settings; Settings also has "Manage Apple subscriptions".

PRIVACY AND ACCOUNT: the app asks for explicit permission before study content is sent to the disclosed AI providers (Google Gemini, Soniox, OpenRouter). Account deletion is in Settings -> Delete account; deleting the Memo account does not cancel an Apple subscription, and the screen explains how to cancel it through Apple. The microphone is used only for recording lectures and for the voice tutor; the camera and photo library only to import study material, and to save an exported mindmap image when asked.

CODES: Settings -> Redeem a code. A creator code such as MEMO50 halves the first month or year. New subscribers get it as the subscription's introductory offer; returning subscribers get a promotional offer signed by our server. The price and the renewal price are always those on Apple's purchase sheet. Website gift codes cannot be applied to App Store purchases, and the app says so.

NOTIFICATIONS: after a note is started, Memo offers to tell you when it is ready. The iOS permission prompt only appears if you agree, and tapping the notification opens that note. Notifications are optional; everything works without them.

ACCOUNTS AND PURCHASES: a subscription belongs to the Memo account that bought it. Restore Purchases on a different Memo account does not move it; the app explains that the purchase belongs to another Memo account.

TUTOR TIME (consumable eu.memoai.tutor.hour): subscribers get 30 minutes of voice-tutor and podcast time a day. To buy more, open "Plant Life Cycle", tap the Tutor tab, then tap the clock-and-percentage meter at the top right, just below the tabs: the sheet shows "Add an hour" with Apple's price, a one-time purchase through Apple. It needs a subscription first (buy one from the paywall with a Sandbox account). Our server credits the hour after verifying the signed transaction.
```
